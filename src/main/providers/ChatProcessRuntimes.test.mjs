import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ProviderProcessStore } from '../ProviderProcessStore.ts'
import { providerProcessContext } from '../providerProcessContext.ts'
import { withChatProcessRuntimes } from './ChatProcessRuntimes.ts'

const setup = async (t, { providerId = 'codex', container = null } = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-chat-runtimes-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new ProviderProcessStore(directory, async () => {
    throw Error('No real launches')
  })
  const calls = [],
    adapters = []
  let next = 0
  const make = () => {
    let listener
    const adapter = {
      id: providerId,
      clearAuthenticationFailure: (container) =>
        calls.push(['clear-auth', container, providerProcessContext.getStore()?.record.id]),
      changeAccount: async (container, change) => {
        calls.push(['change-account', container])
        return change()
      },
      onChatUpdated: (value) => {
        listener = value
        return () => {}
      },
      getChats: async () => ({ chats: [], nextCursor: null }),
      getModels: async (options) => {
        calls.push(['models', options])
        return []
      },
      recoverRuntime: async () =>
        calls.push(['recover', providerProcessContext.getStore()?.record.id]),
      releaseChat: async (id) => calls.push(['release', id]),
      startChat: async (_message, _options, created) => {
        const id = `new-${++next}`
        await created(id)
        assert.equal(providerProcessContext.getStore().record.chatId, id)
        return { id, revision: 1, items: [] }
      },
      forkChat: async (id, _message, created) => {
        const forkId = `fork-${id}`
        await created(forkId)
        return { id: forkId, revision: 1, items: [] }
      },
      continueChat: async (id) => {
        await new Promise((resolve) => setImmediate(resolve))
        const scope = providerProcessContext.getStore()
        calls.push(['continue', id, scope?.record.id])
        listener?.({ id, revision: 1, items: [] })
        return { id, revision: 1, items: [] }
      },
      update: (detail) => listener?.(detail),
      stopChatProcesses: async (id) => {
        calls.push(['stop', id])
        return [id]
      },
      getChat: async (id) => {
        calls.push(['get', id, providerProcessContext.getStore()?.record.id])
        return { id }
      },
      dispose: async () => {}
    }
    adapters.push(adapter)
    return adapter
  }
  const wrap = () =>
    withChatProcessRuntimes(make(), {
      store,
      create: make,
      accountId: 'account',
      metadata: async () => ({ container })
    })
  return { store, calls, adapters, wrap }
}

for (const providerId of ['codex', 'claude', 'copilot', 'opencode-v2']) {
  test(`${providerId} model discovery uses the saved chat environment without claiming a process boundary`, async (t) => {
    const dev = { kind: 'container', tool: 'distrobox', name: 'dev' }
    const h = await setup(t, { providerId, container: dev })
    const adapter = h.wrap()
    for (const supplied of [undefined, { kind: 'host' }]) {
      await adapter.getModels({ chatId: 'saved-chat', container: supplied, accountId: 'account' })
      assert.equal(h.calls.at(-1)[1].container, dev)
      assert.equal(h.calls.at(-1)[1].chatId, 'saved-chat')
      assert.equal(h.calls.at(-1)[1].accountId, 'account')
    }
    const host = { kind: 'host' }
    await adapter.getModels({ container: host })
    assert.equal(h.calls.at(-1)[1].container, host)
    assert.equal((await h.store.all(providerId, 'account')).length, 0)
  })
}

test('concurrent chats get separate boundaries; subsequent calls and updates retain ownership', async (t) => {
  const h = await setup(t),
    adapter = h.wrap(),
    updates = []
  adapter.onChatUpdated((detail) => updates.push(detail.id))
  await Promise.all([
    adapter.continueChat('a', 'work'),
    adapter.continueChat('b', 'work'),
    adapter.continueChat('a', 'again')
  ])
  const executions = h.calls.filter((call) => call[0] === 'continue')
  assert.equal(new Set(executions.filter((call) => call[1] === 'a').map((call) => call[2])).size, 1)
  assert.notEqual(
    executions.find((call) => call[1] === 'a')[2],
    executions.find((call) => call[1] === 'b')[2]
  )
  assert.equal(updates.length, 3)
  await adapter.getChat('a')
  assert.equal(h.calls.at(-1)[2], executions.find((call) => call[1] === 'a')[2])
  assert.equal(providerProcessContext.getStore(), undefined)
})

test('start and fork bind ownership before callbacks; a fork never shares its source boundary', async (t) => {
  const h = await setup(t),
    adapter = h.wrap()
  await adapter.startChat('work', {}, async (id) =>
    assert.ok(await h.store.find('codex', 'account', id, null))
  )
  const source = await h.store.find('codex', 'account', 'new-1', null)
  await adapter.forkChat('new-1', 'message')
  const fork = await h.store.find('codex', 'account', 'fork-new-1', null)
  assert.notEqual(source.record.id, fork.record.id)
  await adapter.continueChat('fork-new-1', 'work')
  assert.equal(h.calls.at(-1)[2], fork.record.id)
})

test('restart recovers exact saved runtime identity; stopping an unknown chat creates no boundary', async (t) => {
  const h = await setup(t)
  const first = h.wrap()
  await first.continueChat('a', 'work')
  const original = (await h.store.find('codex', 'account', 'a', null)).record.id
  await first.dispose()
  const second = h.wrap()
  await second.getChat('a')
  assert.ok(h.calls.some((call) => call[0] === 'recover' && call[1] === original))
  assert.equal(h.calls.at(-1)[2], original)
  const count = (await h.store.all('codex', 'account')).length
  await second.stopChatProcesses('unknown')
  assert.equal((await h.store.all('codex', 'account')).length, count)
})

test('a new boundary keeps revisions increasing and ignores events from its retired runtime', async (t) => {
  const h = await setup(t),
    adapter = h.wrap(),
    updates = []
  adapter.onChatUpdated((detail) => updates.push(detail))
  const first = await adapter.continueChat('a', 'work')
  const scope = await h.store.find('codex', 'account', 'a', null)
  await h.store.stop(scope.record.id)
  const second = await adapter.continueChat('a', 'again')
  assert.ok(second.revision > first.revision)
  const count = updates.length
  h.adapters[1].update({ id: 'a', revision: 999, items: [] })
  assert.equal(updates.length, count)
})

test('account lifecycle changes reach every chat runtime and mutate credentials once', async (t) => {
  const h = await setup(t),
    adapter = h.wrap()
  await adapter.continueChat('a', 'work')
  await adapter.continueChat('b', 'work')
  adapter.clearAuthenticationFailure(null)
  const cleared = h.calls.filter((call) => call[0] === 'clear-auth')
  assert.equal(cleared.length, 3)
  assert.equal(cleared.filter((call) => call[2]).length, 2)
  let changes = 0
  const result = await adapter.changeAccount(null, async () => {
    changes++
    return 'changed'
  })
  assert.equal(result, 'changed')
  assert.equal(changes, 1)
  assert.equal(h.calls.filter((call) => call[0] === 'change-account').length, 3)
})
