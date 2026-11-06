import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { BackgroundChatRecovery } from './BackgroundChatRecovery.ts'
import { getContainerTargetKey } from '../containerTarget.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const chat = (id, changes = {}) => ({
  id,
  status: null,
  lastTurnOutcome: 'stopped',
  updatedAt: 1,
  container: null,
  ...changes
})

const fixture = (read = async (_provider, chat) => ({ ...chat, revision: 1, items: [] })) => {
  let epoch = 0
  const reads = [],
    published = [],
    failures = []
  const recovery = new BackgroundChatRecovery({
    scope: (provider, value) => {
      const captured = epoch
      return {
        key: JSON.stringify([provider, value.id, getContainerTargetKey(value.container)]),
        current: () => epoch === captured
      }
    },
    read: (provider, value) => {
      reads.push([provider, value.id, value.container])
      return read(provider, value)
    },
    publish: (provider, detail) => published.push([provider, detail]),
    failed: (provider, id, error) => failures.push([provider, id, error])
  })
  return {
    recovery,
    reads,
    published,
    failures,
    changeScope: () => {
      epoch++
    }
  }
}

test('all providers recover unresolved chats without selection and coalesce unchanged listings', async () => {
  const h = fixture()
  for (const provider of ['codex', 'claude', 'copilot', 'opencode-v2']) {
    h.recovery.observe(provider, [chat('same-id')])
    h.recovery.observe(provider, [chat('same-id')])
  }
  await tick()
  assert.deepEqual(
    h.published.map(([provider]) => provider),
    ['codex', 'claude', 'copilot', 'opencode-v2']
  )
  for (const provider of ['codex', 'claude', 'copilot', 'opencode-v2'])
    h.recovery.observe(provider, [chat('same-id')])
  await tick()
  assert.equal(h.reads.length, 4)
})

test('background reads have bounded concurrency and do not delay discovery', async () => {
  const gate = deferred()
  const h = fixture(async (_provider, value) => {
    await gate.promise
    return { ...value, revision: 1, items: [] }
  })
  h.recovery.observe('claude', [chat('one'), chat('two'), chat('three')])
  assert.equal(h.reads.length, 0, 'observe must return before provider I/O')
  await tick()
  assert.equal(h.reads.length, 2)
  gate.resolve()
  await tick()
  assert.equal(h.reads.length, 3)
  assert.equal(h.published.length, 3)
})

test('a new listing supersedes an in-flight stale result and queues the latest state', async () => {
  const gate = deferred()
  const h = fixture(async (_provider, value) => {
    if (value.updatedAt === 1) await gate.promise
    return { ...value, revision: value.updatedAt, items: [] }
  })
  h.recovery.observe('copilot', [chat('one')])
  await tick()
  h.recovery.observe('copilot', [chat('one', { updatedAt: 2 })])
  gate.resolve()
  await tick()
  assert.deepEqual(
    h.published.map(([, detail]) => detail.updatedAt),
    [2]
  )
})

test('a terminal discovery cancels an older running recovery', async () => {
  const gate = deferred()
  const h = fixture(async (_provider, value) => {
    await gate.promise
    return { ...value, revision: 1, items: [] }
  })
  h.recovery.observe('opencode-v2', [chat('one', { status: 'active', lastTurnOutcome: null })])
  await tick()
  h.recovery.observe('opencode-v2', [chat('one', { lastTurnOutcome: null, updatedAt: 2 })])
  gate.resolve()
  await tick()
  assert.equal(h.published.length, 0)
})

test('failed reads keep saved data and retry on a later listing', async () => {
  let attempts = 0
  const h = fixture(async (_provider, value) => {
    if (++attempts === 1) throw new Error('offline')
    return { ...value, revision: 1, items: [] }
  })
  h.recovery.observe('claude', [chat('one')])
  await tick()
  assert.equal(h.published.length, 0)
  assert.equal(h.failures.length, 1)
  h.recovery.observe('claude', [chat('one')])
  await tick()
  assert.equal(h.published.length, 1)
})

test('account scope changes discard in-flight reads and invalidate completed recovery', async () => {
  const gate = deferred()
  const h = fixture(async (_provider, value) => {
    await gate.promise
    return { ...value, revision: 1, items: [] }
  })
  h.recovery.observe('claude', [chat('one')])
  await tick()
  h.changeScope()
  gate.resolve()
  await tick()
  assert.equal(h.published.length, 0)
  h.recovery.observe('claude', [chat('one')])
  await tick()
  assert.equal(h.published.length, 1)
  h.changeScope()
  h.recovery.observe('claude', [chat('one')])
  await tick()
  assert.equal(h.published.length, 2)
})

test('execution environments remain separate and completed or archived chats need no read', async () => {
  const h = fixture()
  const remote = { kind: 'container', tool: 'ssh', name: 'remote' }
  h.recovery.observe('copilot', [
    chat('one'),
    chat('one', { container: remote }),
    chat('done', { done: true }),
    chat('hidden', { purpose: 'commit' }),
    chat('complete', { lastTurnOutcome: null })
  ])
  await tick()
  assert.deepEqual(h.reads, [
    ['copilot', 'one', null],
    ['copilot', 'one', remote]
  ])
})

test('shutdown discards late results and queued reads', async () => {
  const gate = deferred()
  const h = fixture(async (_provider, value) => {
    await gate.promise
    return { ...value, revision: 1, items: [] }
  })
  h.recovery.observe('claude', [chat('one'), chat('two'), chat('three')])
  await tick()
  h.recovery.dispose()
  gate.resolve()
  await tick()
  h.recovery.observe('copilot', [chat('four')])
  assert.equal(h.reads.length, 2)
  assert.equal(h.published.length, 0)
})

// Exercise the service's actual discovery hooks and bounded adapter reads, without Electron,
// provider processes, credentials, or a selected conversation.
const serviceFixture = () => {
  const source = ts.createSourceFile(
    'providerService.ts',
    readFileSync(new URL('./providerService.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declarations = new Map(
    source.statements
      .filter(ts.isVariableStatement)
      .flatMap((node) => [...node.declarationList.declarations])
      .map((node) => [node.name.getText(source), node.initializer])
  )
  const reads = [],
    published = []
  const scopes = new Map()
  const scopeFor = (provider, id, container) => {
    const key = JSON.stringify([provider, id, container])
    if (!scopes.has(key)) scopes.set(key, { key, current: () => true })
    return scopes.get(key)
  }
  const context = vm.createContext({
    BackgroundChatRecovery,
    console,
    getContainerTargetKey,
    persistentChatHistory: {
      viewScope: scopeFor,
      accountEpoch: () => 0,
      preview: async () => null,
      observe() {}
    },
    providerApi: { getAccounts: async () => assert.fail('credentials already scoped') },
    durableConversationViews: {
      read: async () => new Map(),
      list: async () => ({
        summaries: [{ ...chat('known'), providerId: 'claude' }],
        nextCursor: null
      })
    },
    getChatUpdateSummary: (view) => view,
    applyMetadataToChats: async (chats) => chats,
    normalizeCwd: (value) => value ?? null,
    knownConversationScopes: new Set(),
    enqueueProviderChatUpdate: (provider, detail) => published.push([provider, detail]),
    adapters: Object.fromEntries(
      ['codex', 'claude', 'copilot', 'opencode-v2'].map((provider) => [
        provider,
        {
          getChats: async (options) => ({
            chats: [chat(provider, { container: options?.container })],
            nextCursor: null
          }),
          getChatWindow: async (id, window, options) => {
            reads.push([provider, id, { ...window }, { ...options }])
            return { ...chat(id), revision: 1, items: [] }
          },
          getChat: async () => assert.fail('background recovery must use bounded history')
        }
      ])
    )
  })
  for (const name of ['backgroundChatRecovery', 'getProviderKnownChats'])
    context[name] = vm.runInContext(
      ts.transpile(`(${declarations.get(name).getText(source)})`, {
        target: ts.ScriptTarget.ES2022
      }),
      context
    )
  const getChats = declarations
    .get('providerApi')
    .properties.find((property) => property.name?.getText(source) === 'getChats').initializer
  context.providerApi.getChats = vm.runInContext(
    ts.transpile(`(${getChats.getText(source)})`, { target: ts.ScriptTarget.ES2022 }),
    context
  )
  return { context, reads, published }
}

test('native discovery schedules bounded recovery through each provider adapter', async () => {
  const h = serviceFixture()
  const remote = { kind: 'container', tool: 'ssh', name: 'remote' }
  for (const provider of ['codex', 'claude', 'copilot', 'opencode-v2'])
    await h.context.providerApi.getChats(provider, { container: remote })
  await tick()
  assert.equal(h.reads.length, 4)
  assert.equal(h.published.length, 4)
  assert.deepEqual(
    h.reads.map(([provider, id, window, options]) => [provider, id, window, options.container]),
    ['codex', 'claude', 'copilot', 'opencode-v2'].map((provider) => [
      provider,
      provider,
      { startIndex: null, limit: 10 },
      remote
    ])
  )
})

test('saved-chat startup discovery recovers state before native listing or selection', async () => {
  const h = serviceFixture()
  await h.context.getProviderKnownChats('claude')
  await tick()
  assert.deepEqual(
    h.reads.map(([provider, id]) => [provider, id]),
    [['claude', 'known']]
  )
  assert.equal(h.published.length, 1)
})
