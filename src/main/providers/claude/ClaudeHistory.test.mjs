import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { loadClaudeHistory } from './ClaudeHistory.ts'
import { ClaudeTranscriptProjection, renderClaudeChatItems } from './ClaudeItemRenderers.ts'

const sessionId = randomUUID()
const options = { active: false, stopped: false }
const summaryText =
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary: earlier work.'
const commandText =
  '<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>'
const record = (type, uuid, parentUuid, content, extra = {}) => ({
  type,
  uuid,
  parentUuid,
  sessionId,
  isSidechain: false,
  timestamp: '2026-09-24T12:00:00.000Z',
  message: { role: type, content },
  ...extra
})
const boundary = (uuid, logicalParentUuid, preserved, extra = {}) => ({
  type: 'system',
  uuid,
  parentUuid: null,
  logicalParentUuid,
  sessionId,
  subtype: 'compact_boundary',
  content: 'Conversation compacted',
  isMeta: false,
  compactMetadata: {
    trigger: 'manual',
    ...(preserved
      ? {
          preservedSegment: {
            headUuid: preserved,
            tailUuid: preserved,
            anchorUuid: `${uuid}-summary`
          },
          preservedMessages: { uuids: [preserved], anchorUuid: `${uuid}-summary` }
        }
      : {})
  },
  ...extra
})
const fixture = () => [
  record('user', 'u1', null, 'First request'),
  record('assistant', 'a1', 'u1', [{ type: 'text', text: 'First answer' }]),
  record('user', 'u2', 'a1', 'Second request'),
  record('assistant', 'a2', 'u2', [{ type: 'text', text: 'Last answer' }]),
  boundary('compact', 'a2', 'a2'),
  record('user', 'compact-summary', 'compact', summaryText, {
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true
  }),
  record('user', 'meta', 'compact-summary', 'Injected context', { isMeta: true }),
  record('user', 'command', 'meta', commandText),
  record('user', 'output', 'command', '<local-command-stdout>Compacted</local-command-stdout>')
]
const store = (entries) => ({
  load: async () => entries,
  append: async () => {
    assert.fail('Loading history must not write to the transcript')
  }
})
const userTexts = (items) =>
  items.filter((item) => item.role === 'user').map((item) => item.content)

test('reopening manual compaction loads original history and delimiter through the real SDK', async () => {
  const entries = fixture()
  const before = structuredClone(entries)
  // Reproduce the old failure: the SDK resumes from the summary and one preserved answer.
  const resume = await getSessionMessages(sessionId, {
    sessionStore: store(entries),
    includeSystemMessages: true
  })
  const oldItems = renderClaudeChatItems(resume, options)
  assert.equal(
    oldItems.some((item) => item.type === 'contextCompaction'),
    false
  )
  assert.equal(
    resume.some((message) => message.uuid === 'u1'),
    false
  )

  const history = await loadClaudeHistory(sessionId, store(entries))
  const items = renderClaudeChatItems(history, options)
  assert.deepEqual(userTexts(items), ['First request', 'Second request'])
  assert.deepEqual(
    items.filter((item) => item.role === 'assistant').map((item) => item.content),
    ['First answer', 'Last answer']
  )
  assert.deepEqual(
    items.filter((item) => item.type === 'contextCompaction').map((item) => item.id),
    ['compact']
  )
  assert.equal(history.find((message) => message.uuid === 'compact-summary').isCompactSummary, true)
  assert.deepEqual(entries, before, 'display loading must not alter model resume ancestry')

  const detail = new ClaudeTranscriptProjection().read(history, [], options)
  assert.equal(detail.turnCount, 2)
  assert.deepEqual(detail.items, items)
  assert.deepEqual(
    userTexts(
      renderClaudeChatItems(history, {
        ...options,
        turnWindow: { startIndex: 0, limit: 1 }
      })
    ),
    ['First request']
  )
  const tail = renderClaudeChatItems(history, {
    ...options,
    turnWindow: { startIndex: null, limit: 1 }
  })
  assert.deepEqual(userTexts(tail), ['Second request'])
  assert.ok(tail.some((item) => item.type === 'contextCompaction'))
})

test('repeated automatic and manual compactions retain the active branch without duplication', async () => {
  const entries = [
    ...fixture(),
    record('user', 'discarded', 'output', 'Abandoned edit'),
    record('assistant', 'discarded-answer', 'discarded', 'Abandoned answer'),
    record('user', 'u3', 'output', 'Edited request'),
    record('assistant', 'a3', 'u3', 'Third answer'),
    boundary('compact2', 'a3', null, { compactMetadata: { trigger: 'auto' } }),
    record('user', 'compact2-summary', 'compact2', summaryText, { isCompactSummary: true }),
    record('user', 'u4', 'compact2-summary', 'Continue'),
    record('assistant', 'a4', 'u4', 'Fourth answer'),
    record('user', 'sidechain', 'a4', 'Subagent request', { isSidechain: true })
  ]
  const history = await loadClaudeHistory(sessionId, store(entries))
  const items = renderClaudeChatItems(history, options)
  assert.deepEqual(userTexts(items), [
    'First request',
    'Second request',
    'Edited request',
    'Continue'
  ])
  assert.equal(items.filter((item) => item.type === 'contextCompaction').length, 2)
  assert.equal(new Set(history.map((message) => message.uuid)).size, history.length)
  assert.equal(
    history.some((message) => message.uuid === 'discarded'),
    false
  )
})

test('history loading retains SDK recovery of sibling assistant blocks and tool results', async () => {
  const entries = [
    record('user', 'u', null, 'Use tools'),
    record('assistant', 'thinking', 'u', [{ type: 'thinking', thinking: 'Plan' }], {
      message: { id: 'api-message', content: [{ type: 'thinking', thinking: 'Plan' }] }
    }),
    record(
      'assistant',
      'tool',
      'u',
      [{ type: 'tool_use', id: 'tool-id', name: 'Read', input: { file_path: '/tmp/file' } }],
      {
        message: {
          id: 'api-message',
          content: [
            { type: 'tool_use', id: 'tool-id', name: 'Read', input: { file_path: '/tmp/file' } }
          ]
        }
      }
    ),
    record(
      'user',
      'result',
      'tool',
      [{ type: 'tool_result', tool_use_id: 'tool-id', content: 'File contents' }],
      { tool_use_result: { file: 'contents' } }
    ),
    record('assistant', 'final', 'result', 'Done'),
    boundary('compact', 'final', null),
    record('user', 'compact-summary', 'compact', summaryText, { isCompactSummary: true })
  ]
  const history = await loadClaudeHistory(sessionId, store(entries))
  assert.ok(history.some((message) => message.uuid === 'thinking'))
  assert.ok(history.some((message) => message.uuid === 'tool'))
  assert.deepEqual(history.find((message) => message.uuid === 'result').tool_use_result, {
    file: 'contents'
  })
})

test('local disk history uses the same compaction restoration without modifying the JSONL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-claude-history-'))
  try {
    const project = join(directory, 'projects', '-fixture')
    await mkdir(project, { recursive: true })
    const path = join(project, `${sessionId}.jsonl`)
    const content =
      fixture()
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    await writeFile(path, content)
    const script = `
      import { loadClaudeHistory } from ${JSON.stringify(new URL('./ClaudeHistory.ts', import.meta.url).href)};
      const records = await loadClaudeHistory(${JSON.stringify(sessionId)});
      console.log(JSON.stringify(records.map(record => ({ uuid: record.uuid, subtype: record.message?.subtype }))));
    `
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
          '--experimental-strip-types',
          '--input-type=module',
          '-e',
          script
        ],
        { env: { ...process.env, CLAUDE_CONFIG_DIR: directory }, encoding: 'utf8' }
      )
    )
    assert.ok(result.some((record) => record.uuid === 'u1'))
    assert.ok(result.some((record) => record.subtype === 'compact_boundary'))
    const { readFile } = await import('node:fs/promises')
    assert.equal(await readFile(path, 'utf8'), content)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
