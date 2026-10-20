import assert from 'node:assert/strict'
import test from 'node:test'
import { ClaudeSessionCatalog } from './ClaudeSessionCatalog.ts'

const candidates = Array.from({ length: 100 }, (_, index) => ({
  sessionId: `session-${index}`,
  mtime: 1000 - index
}))
const summary = async ({ sessionId, mtime }) => ({
  sessionId,
  summary: sessionId,
  lastModified: mtime
})

test('first page hydrates only the requested summaries and older pages retain snapshot ordering', async () => {
  const catalog = new ClaudeSessionCatalog()
  let discoveries = 0
  const reads = []
  const discover = async () => {
    discoveries++
    return [...candidates].reverse()
  }
  const read = async (candidate) => {
    reads.push(candidate.sessionId)
    return summary(candidate)
  }
  const first = await catalog.list('host', null, 10, new Set(), discover, read)
  assert.deepEqual(
    reads,
    candidates.slice(0, 10).map((c) => c.sessionId)
  )
  assert.equal(discoveries, 1)
  const second = await catalog.list(
    'host',
    first.nextCursor,
    10,
    new Set(),
    async () => {
      throw new Error('must not rediscover or reorder when a transcript changes')
    },
    read
  )
  assert.deepEqual(
    second.sessions.map((s) => s.sessionId),
    candidates.slice(10, 20).map((c) => c.sessionId)
  )
  assert.equal(discoveries, 1)
  const refresh = await catalog.list(
    'host',
    null,
    10,
    new Set(),
    async () => [{ sessionId: 'new', mtime: 2000 }, ...candidates],
    read
  )
  assert.equal(refresh.sessions[0].sessionId, 'new')
  assert.notEqual(refresh.nextCursor, first.nextCursor)
  const third = await catalog.list('host', second.nextCursor, 10, new Set(), discover, read)
  assert.equal(
    third.sessions[0].sessionId,
    'session-20',
    'refresh does not invalidate an older in-flight list'
  )
})

test('hidden, duplicate, empty and sidechain candidates do not cause missing visible chats', async () => {
  const catalog = new ClaudeSessionCatalog()
  const source = [
    { sessionId: 'hidden', mtime: 9 },
    { sessionId: 'sidechain', mtime: 8 },
    { sessionId: 'one', mtime: 7 },
    { sessionId: 'one', mtime: 6 },
    { sessionId: 'empty', mtime: 5 },
    { sessionId: 'two', mtime: 4 },
    { sessionId: 'three', mtime: 3 }
  ]
  const read = async (candidate) => {
    assert.notEqual(candidate.sessionId, 'hidden')
    return ['empty', 'sidechain'].includes(candidate.sessionId) ? undefined : summary(candidate)
  }
  const first = await catalog.list('host', null, 2, new Set(['hidden']), async () => source, read)
  assert.deepEqual(
    first.sessions.map((s) => s.sessionId),
    ['one', 'two']
  )
  const second = await catalog.list(
    'host',
    first.nextCursor,
    2,
    new Set(),
    async () => source,
    read
  )
  assert.deepEqual(
    second.sessions.map((s) => s.sessionId),
    ['three']
  )
  assert.equal(second.nextCursor, null)
})

test('cursors cannot mix environments and concurrent slow discovery does not hold up other hosts', async () => {
  const catalog = new ClaudeSessionCatalog()
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const remote = catalog.list('remote', null, 1, new Set(), () => blocked, summary)
  const local = await catalog.list('host', null, 1, new Set(), async () => candidates, summary)
  assert.equal(local.sessions[0].sessionId, 'session-0')
  await assert.rejects(
    catalog.list('remote', local.nextCursor, 1, new Set(), async () => candidates, summary),
    /expired/
  )
  await assert.rejects(
    catalog.list('host', 'invalid', 1, new Set(), async () => candidates, summary),
    /expired/
  )
  release(candidates)
  await remote
})

test('summary I/O is bounded to eight concurrent reads with no page overfetch', async () => {
  const catalog = new ClaudeSessionCatalog()
  let active = 0
  let peak = 0
  const reads = []
  const read = async (candidate) => {
    active++
    peak = Math.max(peak, active)
    reads.push(candidate.sessionId)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    return summary(candidate)
  }
  const page = await catalog.list('host', null, 19, new Set(), async () => candidates, read)
  assert.equal(page.sessions.length, 19)
  assert.equal(reads.length, 19)
  assert.equal(peak, 8)
})
