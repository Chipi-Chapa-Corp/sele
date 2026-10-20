import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import {
  appendHistoryLines,
  readHistoryLines,
  encodeClaudeHistory,
  encodeCopilotHistory,
  historyMessageId
} from './NativeHistoryImport.ts'
import { migrationNote, withMigrationNote } from './ChatTranscript.ts'

const source = ts.createSourceFile(
  'OpenCodeHistoryImport.ts',
  readFileSync(new URL('./opencode/OpenCodeHistoryImport.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const codec = source.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (entry) => entry.name.getText(source) === 'encodeOpenCodeHistory'
    )
)
const encodeOpenCodeHistory = vm.runInNewContext(
  ts.transpile(`${codec.getText(source).replace('export ', '')}; encodeOpenCodeHistory`, {
    target: ts.ScriptTarget.ES2022
  }),
  { historyMessageId, withMigrationNote, Date }
)

const messages = [
  { id: 'source-user-1', role: 'user', content: 'Keep the full prompt: 你好 🦊\nSecond line' },
  {
    id: 'source-answer-1',
    role: 'assistant',
    content: 'Full answer, without foreign tool records.'
  },
  { id: 'source-user-2', role: 'user', content: `${migrationNote}\nAlready annotated prompt` },
  { id: 'source-answer-2', role: 'assistant', content: 'Final answer.' }
]

test('Claude SDK can read imported exchanges chained after a native internal attachment', async () => {
  const sessionId = '22222222-2222-4222-8222-222222222222'
  const original = encodeClaudeHistory(sessionId, '/fixture', messages.slice(0, 2), null)
  const attachment = {
    type: 'attachment',
    uuid: '33333333-3333-4333-8333-333333333333',
    parentUuid: original.at(-1).uuid,
    sessionId,
    attachment: { type: 'directory', path: '/fixture' }
  }
  const added = encodeClaudeHistory(sessionId, '/fixture', messages.slice(2), attachment.uuid)
  assert.equal(added[0].parentUuid, attachment.uuid)
  const entries = [...original, attachment, ...added]
  const parsed = await getSessionMessages(sessionId, {
    sessionStore: {
      load: async () => entries,
      append: async () => {
        throw new Error('Unexpected SDK write')
      }
    }
  })
  assert.deepEqual(
    parsed
      .filter((entry) => ['user', 'assistant'].includes(entry.type))
      .map((entry) => entry.message.content.map((block) => block.text).join('')),
    messages.map((entry) =>
      entry.role === 'user' && !entry.content.startsWith(migrationNote)
        ? `${migrationNote}\n${entry.content}`
        : entry.content
    )
  )
  const known = new Set(entries.map((entry) => entry.uuid))
  assert.deepEqual(
    encodeClaudeHistory(sessionId, '/fixture', messages, attachment.uuid, known),
    [],
    'retry must not duplicate imported messages'
  )
})

test('Copilot imports form a complete event chain with terminal assistant turns and idempotent IDs', () => {
  const events = encodeCopilotHistory(messages, 'native-last-event')
  let parent = 'native-last-event'
  for (const event of events) {
    assert.equal(event.parentId, parent)
    parent = event.id
  }
  assert.equal(events.filter((event) => event.type === 'assistant.turn_end').length, 2)
  assert.deepEqual(
    events.filter((event) => event.type === 'assistant.turn_end').map((event) => event.data.turnId),
    ['0', '1']
  )
  assert.equal(events[0].data.interactionId, events[1].data.interactionId)
  assert.equal(events[0].data.turnId, events[1].data.turnId)
  assert(
    events
      .filter((event) => event.type === 'assistant.message')
      .every((event) => event.data.toolRequests.length === 0)
  )
  assert.equal(events[0].data.content, `${migrationNote}\n${messages[0].content}`)
  assert.equal(
    events.find((event) => event.type === 'user.message' && event.id !== events[0].id).data.content,
    messages[2].content
  )
  assert.deepEqual(
    encodeCopilotHistory(messages, events.at(-1).id, new Set(events.map((event) => event.id))),
    []
  )
})

test('append preserves every existing native tool record byte-for-byte', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-native-import-'))
  try {
    const path = join(root, 'native', 'events.jsonl')
    const ownTool = {
      type: 'tool.execution_complete',
      id: 'native-tool',
      data: { output: 'Keep all native tool output\nUnicode: 🦊' }
    }
    await appendHistoryLines(path, [ownTool])
    await appendHistoryLines(path, encodeCopilotHistory(messages, ownTool.id))
    const records = await readHistoryLines(path)
    assert.deepEqual(records[0], ownTool)
    assert.equal(records[1].parentId, ownTool.id)
    assert.equal(records.filter((entry) => entry.type === 'user.message').length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OpenCode imports have stable retry IDs, correct assistant parents, no tools, and historical timestamps', () => {
  const session = { id: 'ses_fixture', directory: '/fixture' },
    model = { providerID: 'anthropic', modelID: 'small' }
  const encoded = encodeOpenCodeHistory(session, messages, model)
  assert.equal(encoded[1].info.parentID, encoded[0].info.id)
  assert.equal(encoded[3].info.parentID, encoded[2].info.id)
  assert(encoded.every((entry) => entry.parts.length === 1 && entry.parts[0].type === 'text'))
  assert(encoded.every((entry) => entry.info.time.created <= Date.now()))
  assert.equal(encoded[0].parts[0].text, `${migrationNote}\n${messages[0].content}`)
  assert.deepEqual(
    Array.from(encodeOpenCodeHistory(session, messages, model), (entry) => entry.info.id),
    Array.from(encoded, (entry) => entry.info.id)
  )
  assert.equal(new Set(encoded.map((entry) => entry.info.id)).size, messages.length)
})
