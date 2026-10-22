import assert from 'node:assert/strict'
import test from 'node:test'
import { PersistentChatHistory } from './PersistentChatHistory.ts'

const chat = (extra = {}) => ({
  providerId: 'codex',
  id: 'chat',
  createdAt: 1,
  updatedAt: 2,
  title: 'Fixture',
  preview: 'Answer',
  cwd: '/fixture',
  container: null,
  status: null,
  done: false,
  purpose: null,
  pinned: false,
  ...extra
})
const detail = (extra = {}) => ({
  ...chat(),
  revision: 99,
  capabilities: { editMessages: true, activeMessages: true },
  pendingApproval: null,
  pendingUserInput: null,
  items: [
    { type: 'message', id: 'u', role: 'user', content: 'Question' },
    { type: 'message', id: 'a', role: 'assistant', content: 'Answer' }
  ],
  turnPagination: { kind: 'cursor', olderCursor: 'older', newerCursor: null },
  turnCount: 1,
  ...extra
})
const account = (cache, id = 'account-a', provider = 'codex', container = null) =>
  cache.setAccount(
    provider,
    container,
    { accounts: [{ id, active: true, login: id }] },
    cache.accountEpoch(provider, container)
  )
const fixture = () => {
  const rows = new Map()
  const calls = []
  const store = {
    async read(key, fingerprint) {
      calls.push(['read', key])
      const row = rows.get(key)
      return row?.fingerprint === fingerprint ? structuredClone(row.history) : null
    },
    async save(key, fingerprint, history, current) {
      if (!current()) return false
      calls.push(['save', key])
      rows.set(key, { fingerprint, history: structuredClone(history) })
      return true
    }
  }
  const cache = new PersistentChatHistory(store)
  account(cache)
  cache.observe([chat()])
  return { cache, rows, store, calls }
}

test('restart previews contain saved turns and fresh sidebar metadata, never persisted permissions', async () => {
  const f = fixture()
  await f.cache.save(f.cache.begin('codex', 'chat'), detail())
  const restarted = new PersistentChatHistory(f.store)
  account(restarted)
  restarted.observe([chat({ pinned: true, seenUpdatedAt: 100 })])
  const preview = await restarted.preview('codex', 'chat')
  assert.deepEqual(preview.items, detail().items)
  assert.equal(preview.pinned, true)
  assert.equal(preview.seenUpdatedAt, 100)
  assert.equal(preview.revision, -1, 'process-local revisions must not survive restart')
  assert.equal(preview.writeAccess, 'checking')
  assert.equal(preview.historyPreview, true)
  assert.deepEqual(preview.capabilities, { editMessages: false, activeMessages: false })
  assert.equal(preview.pendingApproval, null)
  assert.equal(preview.pendingUserInput, null)
})

test('provider, account, environment, runtime, and source fingerprint separate cache entries', async () => {
  const f = fixture()
  await f.cache.save(f.cache.begin('codex', 'chat'), detail())
  account(f.cache, 'account-b')
  assert.equal(await f.cache.preview('codex', 'chat'), null)
  account(f.cache)
  for (const extra of [{ updatedAt: 3 }, { preview: 'Edited' }, { title: 'Renamed' }]) {
    f.cache.observe([chat(extra)])
    assert.equal(await f.cache.preview('codex', 'chat'), null)
  }
  f.cache.observe([chat()])
  const remote = { kind: 'container', tool: 'ssh', name: 'host-b', runtime: { kind: 'host' } }
  account(f.cache, 'account-a', 'codex', remote)
  f.cache.observe([chat({ container: remote })])
  assert.equal(await f.cache.preview('codex', 'chat', remote), null)
  account(f.cache, 'account-a', 'claude')
  f.cache.observe([chat({ providerId: 'claude' })])
  assert.equal(await f.cache.preview('claude', 'chat'), null)
  assert.ok(await f.cache.preview('codex', 'chat'))
})

test('streaming, queued work, approvals, authentication failures, and commit chats never persist', async () => {
  const f = fixture()
  const read = f.cache.begin('codex', 'chat')
  for (const extra of [
    { status: 'active' },
    { status: 'waitingOnApproval' },
    { purpose: 'commit' },
    { done: true },
    { pendingApproval: { id: 'approval' } },
    { pendingUserInput: { id: 'question' } },
    { authenticationRequired: true },
    { historyPreview: true },
    { turnPagination: { kind: 'cursor', olderCursor: null, newerCursor: 'after' } },
    { turnPagination: undefined, itemsStartTurnIndex: 0, turnCount: 2 },
    { items: [{ type: 'pendingMessage', id: 'pending' }] },
    { items: [{ type: 'working', status: 'working', id: 'work', items: [] }] }
  ])
    await f.cache.save(read, detail(extra))
  assert.equal(f.rows.size, 0)
  f.cache.observe([chat({ status: 'active' })])
  assert.equal(f.cache.begin('codex', 'chat'), null)
})

test('updates invalidate in-flight reads/writes, then a fresh opening can repopulate the cache', async () => {
  const f = fixture()
  const oldRead = f.cache.begin('codex', 'chat')
  await f.cache.save(oldRead, detail())
  let finish
  const originalRead = f.store.read
  f.store.read = async (...args) => {
    const result = await originalRead(...args)
    await new Promise((resolve) => {
      finish = resolve
    })
    return result
  }
  const pending = f.cache.preview('codex', 'chat')
  await new Promise((resolve) => setImmediate(resolve))
  f.cache.invalidate('codex', 'chat')
  finish()
  assert.equal(await pending, null)
  await f.cache.save(oldRead, detail())
  assert.equal(f.calls.filter(([kind]) => kind === 'save').length, 1)
  const fresh = f.cache.begin('codex', 'chat')
  await f.cache.save(
    fresh,
    detail({ items: [{ type: 'message', id: 'edited', role: 'user', content: 'Edited' }] })
  )
  f.store.read = originalRead
  assert.equal((await f.cache.preview('codex', 'chat')).items[0].id, 'edited')
})

test('account switches reject old account checks and pending saves, including switch-away-and-back', async () => {
  const f = fixture()
  const epoch = f.cache.accountEpoch('codex')
  const read = f.cache.begin('codex', 'chat')
  f.cache.forgetAccount('codex')
  f.cache.setAccount('codex', null, { accounts: [{ id: 'account-a', active: true }] }, epoch)
  assert.equal(f.cache.begin('codex', 'chat'), null)
  await f.cache.save(read, detail())
  assert.equal(f.rows.size, 0)
  account(f.cache)
  // A read that crossed an account mutation is never admitted even if the same account returns.
  await f.cache.save(read, detail())
  assert.equal(f.rows.size, 0)
})

test('newer idle replies win over slower old saves, and disposal cancels pending admissions', async () => {
  const f = fixture()
  const save = f.store.save
  let release
  f.store.save = async (...args) => {
    if (!release)
      await new Promise((resolve) => {
        release = resolve
      })
    return save(...args)
  }
  const read = f.cache.begin('codex', 'chat')
  const older = f.cache.save(read, detail({ revision: 1 }))
  await f.cache.save(
    f.cache.begin('codex', 'chat'),
    detail({
      revision: 2,
      items: [{ type: 'message', id: 'newest', role: 'user', content: 'Newest' }]
    })
  )
  release()
  await older
  assert.equal((await f.cache.preview('codex', 'chat')).items[0].id, 'newest')
  f.cache.dispose()
  assert.equal(f.cache.begin('codex', 'chat'), null)
  await f.cache.save(read, detail({ revision: 3 }))
  assert.equal(f.calls.filter(([kind]) => kind === 'save').length, 1)
})

test('discovered remote environments can record opening pages without crossing preview scopes', async () => {
  const f = fixture()
  const remote = { kind: 'container', tool: 'ssh', name: 'remote', runtime: { kind: 'host' } }
  const other = new PersistentChatHistory(f.store)
  account(other, 'account-a', 'codex', remote)
  other.observe([chat({ container: remote })])
  const read = other.beginOpening('codex', 'chat')
  assert.ok(read)
  await other.save(read, detail({ container: remote }))
  assert.equal(await other.preview('codex', 'chat'), null)
  assert.ok(await other.preview('codex', 'chat', remote))
})

test('durable view identity survives native freshness/status changes and includes confirmed empty-account configurations', () => {
  const f = fixture()
  const scope = f.cache.viewScope('codex', 'chat')
  f.cache.invalidate('codex', 'chat')
  f.cache.observe([chat({ updatedAt: 999, status: 'active', done: true })])
  assert.equal(scope.current(), true, 'metadata freshness never erases durable knowledge')
  assert.equal(f.cache.begin('codex', 'chat'), null, 'legacy preview eligibility stays independent')
  f.cache.forgetAccount('codex')
  assert.equal(scope.current(), false)
  f.cache.setAccount('codex', null, { accounts: [] }, f.cache.accountEpoch('codex'))
  const anonymous = f.cache.viewScope('codex', 'chat')
  assert.ok(anonymous)
  assert.notEqual(anonymous.key, scope.key)
})

test('opening view identities resolve discovered remote sources without guessing across collisions', () => {
  const f = fixture()
  const remote = { kind: 'container', tool: 'ssh', name: 'remote', runtime: { kind: 'host' } }
  const identity = new PersistentChatHistory(f.store)
  account(identity)
  account(identity, 'account-a', 'codex', remote)
  identity.observe([chat({ container: remote })])
  assert.equal(identity.openingViewScope('codex', 'chat').containerKey, 'ssh:remote/from:host')
  identity.observe([chat()])
  assert.equal(identity.openingViewScope('codex', 'chat'), null)
  assert.equal(identity.openingViewScope('codex', 'chat', { kind: 'host' }).containerKey, 'host')
})
