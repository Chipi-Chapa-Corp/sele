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
  await f.store.flush()
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
