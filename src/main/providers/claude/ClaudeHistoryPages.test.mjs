import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ClaudeHistoryPages } from './ClaudeHistoryPages.ts'
import { openClaudeHistorySource } from './ClaudeHistorySource.ts'
import { restoreClaudeHistory } from './ClaudeHistory.ts'
import { renderClaudeChatItems } from './ClaudeItemRenderers.ts'
import { getProviderChatTurns } from '../../../shared/chatTurns.ts'
const sessionId = randomUUID()
const record = (type, uuid, parentUuid, content, extra = {}) => ({
  type,
  uuid,
  parentUuid,
  sessionId,
  cwd: '/fixture',
  timestamp: '2026-09-24T12:00:00.000Z',
  message: { role: type, content },
  ...extra
})
const turns = (count, padding = '') =>
  Array.from({ length: count }, (_, i) => [
    record('user', `u${i}`, i ? `a${i - 1}` : null, `Prompt ${i}`),
    record('assistant', `a${i}`, `u${i}`, `Answer ${i} ${padding}`)
  ]).flat()
const fixture = (entries) => {
  let data = Buffer.from(entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  let identity = 'file-1'
  let bytes = 0
  let revision = 0
  const pages = new ClaudeHistoryPages()
  const source = async () => ({
    identity,
    size: data.length,
    modified: data.length + revision,
    read: async (offset, length) => {
      bytes += length
      return data.subarray(offset, offset + length)
    },
    close: async () => {}
  })
  return {
    pages,
    read: (cursor = null, direction = 'older', id = sessionId, scope = 'host') =>
      pages.read(id, scope, { cursor, direction, limit: 10 }, source),
    append: (entries) => {
      data = Buffer.concat([
        data,
        Buffer.from(entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
      ])
    },
    appendRaw: (text) => {
      data = Buffer.concat([data, Buffer.from(text)])
    },
    rewriteSameSize: () => {
      data = Buffer.from(data.toString().replace('Prompt 0', 'Change 0'))
      revision += 1
    },
    replace: (entries) => {
      data = Buffer.from(entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
      identity = 'file-2'
    },
    get bytes() {
      return bytes
    },
    get size() {
      return data.length
    }
  }
}
const items = (page) => renderClaudeChatItems(page.messages, { active: false, stopped: false })

test('opening reads a bounded tail; older/newer pages round-trip with identical IDs', async () => {
  const entries = turns(1000, 'x'.repeat(4096))
  const f = fixture(entries)
  const latest = await f.read()
  assert.equal(latest.messages[0].uuid, 'u990')
  assert.equal(latest.messages.at(-1).uuid, 'a999')
  assert.equal(latest.pagination.newerCursor, null)
  assert.ok(f.bytes < 150000, `read ${f.bytes} of ${f.size} bytes`)
  const older = await f.read(latest.pagination.olderCursor)
  assert.equal(older.messages[0].uuid, 'u980')
  assert.equal(older.messages.at(-1).uuid, 'a989')
  const newer = await f.read(older.pagination.newerCursor, 'newer')
  assert.deepEqual(items(newer), items(latest))
  assert.equal(newer.pagination.olderCursor, latest.pagination.olderCursor)
  assert.equal(
    new Set([...items(older), ...items(latest)].map((i) => i.id)).size,
    items(older).length + items(latest).length
  )
})

test('all cursor pages exactly match full SDK recovery across branches, compactions and tools', async () => {
  const entries = turns(30, 'z'.repeat(6000))
  entries.push(
    record('user', 'abandoned', 'a29', 'Discarded edit'),
    record('assistant', 'abandoned-answer', 'abandoned', 'Discarded answer'),
    {
      type: 'system',
      uuid: 'compact',
      parentUuid: null,
      logicalParentUuid: 'a29',
      sessionId,
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      compactMetadata: { preservedMessages: { uuids: ['a29'], anchorUuid: 'summary' } }
    },
    record('user', 'summary', 'compact', 'Summary', { isCompactSummary: true }),
    record('user', 'meta', 'summary', 'Injected context', { isMeta: true }),
    record('user', 'continue', 'meta', 'Continue'),
    record('assistant', 'thinking', 'continue', null, {
      message: { id: 'msg_split', content: [{ type: 'thinking', thinking: 'Plan' }] }
    }),
    record('assistant', 'tool', 'continue', null, {
      message: {
        id: 'msg_split',
        content: [{ type: 'tool_use', id: 'tool', name: 'Read', input: { file_path: '/a' } }]
      }
    }),
    record('user', 'result', 'tool', [
      { type: 'tool_result', tool_use_id: 'tool', content: 'result' }
    ]),
    record('assistant', 'final', 'result', 'Done'),
    record('user', 'sidechain', 'final', 'Agent', { isSidechain: true })
  )
  const f = fixture(entries)
  const chunks = []
  let page = await f.read()
  while (true) {
    chunks.unshift(items(page))
    if (!page.pagination.olderCursor) break
    page = await f.read(page.pagination.olderCursor)
  }
  const reference = renderClaudeChatItems(await restoreClaudeHistory(sessionId, entries), {
    active: false,
    stopped: false
  })
  assert.deepEqual(chunks.flat(), reference)
})

test('append preserves snapshot pages; foreign, truncated and replaced sources reject cursors', async () => {
  const f = fixture(turns(35))
  const latest = await f.read()
  f.append([
    record('user', 'new', 'a34', 'New prompt'),
    record('assistant', 'new-answer', 'new', 'New answer')
  ])
  const older = await f.read(latest.pagination.olderCursor)
  assert.equal(older.messages[0].uuid, 'u15')
  const newer = await f.read(older.pagination.newerCursor, 'newer')
  assert.deepEqual(items(newer), items(latest))
  await assert.rejects(f.read(latest.pagination.olderCursor, 'older', randomUUID()), /expired/)
  await assert.rejects(
    f.read(latest.pagination.olderCursor, 'older', sessionId, 'remote'),
    /expired/
  )
  const fresh = await f.read()
  assert.equal(fresh.messages.at(-1).uuid, 'new-answer')
  f.replace(turns(10))
  await assert.rejects(f.read(latest.pagination.olderCursor), /changed/)
})

test('large selected records, UTF-8 block splits and partial final writes preserve complete turns', async () => {
  const entries = turns(12, '猫'.repeat(30000))
  const f = fixture(entries)
  f.append([{ type: 'progress', uuid: 'progress', parentUuid: 'a11' }])
  f.appendRaw('{"type":"assistant","uuid":"partial","message":')
  const page = await f.read()
  assert.equal(page.messages[0].uuid, 'u2')
  assert.equal(getProviderChatTurns(items(page)).length, 10)
  const reference = renderClaudeChatItems(await restoreClaudeHistory(sessionId, entries), {
    active: false,
    stopped: false
  })
  assert.deepEqual(
    items(page),
    getProviderChatTurns(reference)
      .slice(-10)
      .flatMap((t) => t.items)
  )
})

test('real local and shell-backed range transports return the same bounded pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-history-pages-'))
  const previous = process.env.CLAUDE_CONFIG_DIR
  try {
    process.env.CLAUDE_CONFIG_DIR = root
    const project = join(root, 'projects', '-fixture')
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, `${sessionId}.jsonl`),
      turns(100, 'x'.repeat(4096))
        .map((e) => JSON.stringify(e))
        .join('\n') + '\n'
    )
    const commands = []
    const run = async (script, args = []) => {
      commands.push(script)
      return (
        await promisify(execFile)('/bin/sh', ['-c', script, 'fixture', ...args], {
          env: { ...process.env, CLAUDE_CONFIG_DIR: root }
        })
      ).stdout
    }
    const pages = new ClaudeHistoryPages()
    const window = { cursor: null, direction: 'older', limit: 10 }
    const local = await pages.read(sessionId, 'local', window, () =>
      openClaudeHistorySource(sessionId)
    )
    const remote = await pages.read(sessionId, 'remote', window, () =>
      openClaudeHistorySource(sessionId, run)
    )
    assert.deepEqual(items(local), items(remote))
    const older = await pages.read(
      sessionId,
      'remote',
      { ...window, cursor: remote.pagination.olderCursor },
      () => openClaudeHistorySource(sessionId, run)
    )
    assert.equal(older.messages[0].uuid, 'u80')
    assert.ok(commands.some((c) => c.includes('dd if=')))
    assert.ok(commands.every((c) => !c.includes('cat ')))
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('same-size rewrites invalidate old cursors even when the tail fingerprint is unchanged', async () => {
  const f = fixture(turns(100, 'x'.repeat(4096)))
  const latest = await f.read()
  f.rewriteSameSize()
  await assert.rejects(f.read(latest.pagination.olderCursor), /changed/)
})

test('reset cancels in-flight page loads and closes the source', async () => {
  const pages = new ClaudeHistoryPages()
  let closed = false
  const pending = pages.read(
    sessionId,
    'host',
    { cursor: null, direction: 'older', limit: 10 },
    async () => ({
      identity: 'file',
      size: 0,
      modified: 0,
      read: async () => Buffer.alloc(0),
      close: async () => {
        closed = true
      }
    })
  )
  pages.clear()
  await assert.rejects(pending, /reset/)
  assert.equal(closed, true)
})
