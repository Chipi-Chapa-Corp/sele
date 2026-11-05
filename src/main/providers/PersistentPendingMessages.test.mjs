import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PersistentPendingMessages,
  flushPersistentPendingMessages
} from './PersistentPendingMessages.ts'

const fixture = (initial = {}) => {
  const rows = new Map(Object.entries(initial))
  const writes = []
  let failNextWrite = false
  const backend = {
    async read(providerId, chatId) {
      return structuredClone(rows.get(`${providerId}:${chatId}`) ?? [])
    },
    async replace(providerId, chatId, next) {
      if (failNextWrite) {
        failNextWrite = false
        throw new Error('disk full')
      }
      writes.push([chatId, next.map((row) => row.id)])
      rows.set(`${providerId}:${chatId}`, structuredClone(next))
    }
  }
  return {
    store: new PersistentPendingMessages('claude', backend),
    rows: (chatId) => rows.get(`claude:${chatId}`) ?? [],
    writes,
    failWrite: () => {
      failNextWrite = true
    }
  }
}

const message = (id, extra = {}) => ({
  id,
  kind: 'queued',
  submitted: false,
  createdAt: 1,
  payload: { id, content: id },
  ...extra
})

const row = (id, extra = {}) => ({
  id,
  kind: 'queued',
  submitted: false,
  createdAt: 1,
  payload: JSON.stringify({ id, content: id }),
  ...extra
})

test('a chat restores its stored messages once, then keeps its live list', async () => {
  const f = fixture({ 'claude:chat': [row('a'), row('b', { kind: 'steering', submitted: true })] })
  const restored = await f.store.restore('chat')
  assert.deepEqual(
    restored.map((entry) => [entry.id, entry.kind, entry.submitted, entry.payload.content]),
    [
      ['a', 'queued', false, 'a'],
      ['b', 'steering', true, 'b']
    ]
  )
  assert.deepEqual(await f.store.restore('chat'), [])

  f.store.save('chat', [message('b')])
  await f.store.flush()
  assert.deepEqual(
    f.rows('chat').map((entry) => entry.id),
    ['b']
  )
})

test('saves are ignored until the chat has been restored or created in this process', async () => {
  const f = fixture({ 'claude:old': [row('kept')] })
  // An adapter can publish a chat before loading its stored queue; that must not erase it.
  f.store.save('old', [])
  f.store.save('old', [message('new')])
  await f.store.flush()
  assert.deepEqual(f.writes, [])
  assert.deepEqual(
    (await f.store.restore('old')).map((entry) => entry.id),
    ['kept']
  )

  f.store.track('created')
  assert.deepEqual(await f.store.restore('created'), [])
  f.store.save('created', [message('queued')])
  await f.store.flush()
  assert.deepEqual(f.writes, [['created', ['queued']]])
})

test('unchanged lists are not rewritten and one burst of changes is written once', async () => {
  const f = fixture()
  f.store.track('chat')
  const first = message('a')
  const second = message('b')
  f.store.save('chat', [first])
  f.store.save('chat', [first, second])
  await f.store.flush()
  assert.deepEqual(f.writes, [['chat', ['a', 'b']]])

  f.store.save('chat', [first, second])
  await f.store.flush()
  assert.equal(f.writes.length, 1)

  // Kind and delivery can change on the same payload object; both are compared.
  f.store.save('chat', [first, { ...second, kind: 'steering' }])
  await f.store.flush()
  f.store.save('chat', [first, { ...second, kind: 'steering', submitted: true }])
  await f.store.flush()
  assert.deepEqual(
    f.rows('chat').map((entry) => [entry.kind, entry.submitted]),
    [
      ['queued', false],
      ['steering', true]
    ]
  )
  assert.equal(f.writes.length, 3)
})

test('dropping every restored message clears storage', async () => {
  const f = fixture({ 'claude:chat': [row('delivered', { kind: 'steering', submitted: true })] })
  await f.store.restore('chat')
  f.store.save('chat', [])
  await f.store.flush()
  assert.deepEqual(f.rows('chat'), [])
})

test('payloads are serialized when saved, not when written', async () => {
  const f = fixture()
  f.store.track('chat')
  const payload = { content: 'before' }
  f.store.save('chat', [message('a', { payload })])
  payload.content = 'after'
  await f.store.flush()
  assert.equal(JSON.parse(f.rows('chat')[0].payload).content, 'before')
})

test('in-place option changes are saved after invalidation', async () => {
  const f = fixture()
  f.store.track('chat')
  const payload = { options: { sandboxMode: 'read-only' } }
  const entry = message('a', { payload })
  f.store.save('chat', [entry])
  await f.store.flush()
  payload.options = { sandboxMode: 'workspace-write' }
  f.store.save('chat', [entry])
  await f.store.flush()
  assert.equal(f.writes.length, 1)
  f.store.invalidate('chat')
  f.store.save('chat', [entry])
  await f.store.flush()
  assert.equal(JSON.parse(f.rows('chat')[0].payload).options.sandboxMode, 'workspace-write')
})

test('a failed write is retried by the next save', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture()
  f.store.track('chat')
  const entry = message('a')
  f.failWrite()
  f.store.save('chat', [entry])
  await assert.rejects(f.store.flush(), /disk full/)
  assert.deepEqual(f.rows('chat'), [])
  f.store.save('chat', [entry])
  await f.store.flush()
  assert.deepEqual(
    f.rows('chat').map((stored) => stored.id),
    ['a']
  )
})

test('closing keeps the last saved list and ignores teardown changes', async () => {
  const f = fixture()
  f.store.track('chat')
  f.store.save('chat', [message('a'), message('b')])
  const closed = f.store.close()
  f.store.save('chat', [])
  await closed
  await flushPersistentPendingMessages()
  assert.deepEqual(
    f.rows('chat').map((entry) => entry.id),
    ['a', 'b']
  )
  assert.deepEqual(await f.store.restore('other'), [])
})

test('an unreadable stored message is skipped', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture({ 'claude:chat': [row('a'), { ...row('broken'), payload: '{' }] })
  assert.deepEqual(
    (await f.store.restore('chat')).map((entry) => entry.id),
    ['a']
  )
})

test('a failed restore rejects all waiters and leaves durable messages available for retry', async (t) => {
  t.mock.method(console, 'error', () => {})
  let reads = 0
  let rows = [row('old')]
  const store = new PersistentPendingMessages('claude', {
    read: async () => {
      if (++reads === 1) throw new Error('temporary read failure')
      return rows
    },
    replace: async (_provider, _chat, next) => {
      rows = next
    }
  })
  const first = store.restore('chat')
  const concurrent = store.restore('chat')
  await Promise.all([
    assert.rejects(first, /temporary read failure/),
    assert.rejects(concurrent, /temporary read failure/)
  ])
  store.save('chat', [message('new')])
  await store.flush()
  assert.deepEqual(
    rows.map((entry) => entry.id),
    ['old'],
    'an unread queue cannot be replaced'
  )
  const restored = await store.restore('chat')
  assert.deepEqual(
    restored.map((entry) => entry.id),
    ['old']
  )
  store.save('chat', [...restored, message('new')])
  await store.close()
  assert.equal(reads, 2)
  assert.deepEqual(
    rows.map((entry) => entry.id),
    ['old', 'new']
  )
})

test('failed writes reject durability barriers and retry without another save', async (t) => {
  t.mock.method(console, 'error', () => {})
  let fail = true
  let attempts = 0
  let rows = []
  const store = new PersistentPendingMessages('claude', {
    read: async () => rows,
    replace: async (_provider, _chat, next) => {
      attempts++
      if (fail) throw new Error('disk unavailable')
      rows = next
    }
  })
  store.track('chat')
  store.save('chat', [message('kept')])
  await assert.rejects(store.flush(), /disk unavailable/)
  await assert.rejects(store.close(), /disk unavailable/)
  assert.equal(attempts, 2, 'each barrier attempts the dirty snapshot once instead of spinning')
  fail = false
  await flushPersistentPendingMessages()
  await store.close()
  assert.deepEqual(
    rows.map((entry) => entry.id),
    ['kept']
  )
})

test('a failed empty replacement remains dirty until storage is cleared', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture({ 'claude:chat': [row('removed')] })
  await f.store.restore('chat')
  f.failWrite()
  f.store.save('chat', [])
  await assert.rejects(f.store.flush(), /disk full/)
  f.store.save('chat', [])
  await f.store.close()
  assert.deepEqual(f.rows('chat'), [])
})

test('a newer snapshot replaces an in-flight failed write without restoring obsolete rows', async (t) => {
  t.mock.method(console, 'error', () => {})
  let rejectFirst
  const first = new Promise((_resolve, reject) => {
    rejectFirst = reject
  })
  const writes = []
  const store = new PersistentPendingMessages('claude', {
    read: async () => [],
    replace: async (_provider, chatId, rows) => {
      writes.push([chatId, rows.map((entry) => entry.id)])
      if (writes.length === 1) await first
    }
  })
  store.track('chat')
  store.track('sibling')
  store.save('chat', [message('old')])
  await new Promise(setImmediate)
  store.save('chat', [message('latest')])
  store.save('sibling', [message('independent')])
  rejectFirst(new Error('first write failed'))
  await store.close()
  assert.deepEqual(writes, [
    ['chat', ['old']],
    ['chat', ['latest']],
    ['sibling', ['independent']]
  ])
})

test('one failing chat does not block another queue and a background failure remains retryable', async (t) => {
  t.mock.method(console, 'error', () => {})
  const rows = new Map()
  const writes = []
  let fail = true
  const store = new PersistentPendingMessages('claude', {
    read: async () => [],
    replace: async (_provider, chatId, next) => {
      writes.push(chatId)
      if (chatId === 'failed' && fail) throw new Error('one queue failed')
      rows.set(chatId, next)
    }
  })
  for (const chat of ['failed', 'healthy']) {
    store.track(chat)
    store.save(chat, [message(chat)])
  }
  await new Promise(setImmediate)
  assert.deepEqual(
    rows.get('healthy').map((entry) => entry.id),
    ['healthy']
  )
  assert.deepEqual(writes, ['failed', 'healthy'])
  fail = false
  await store.close()
  assert.deepEqual(writes, ['failed', 'healthy', 'failed'])
  assert.deepEqual(
    rows.get('failed').map((entry) => entry.id),
    ['failed']
  )
})
