import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { OpenCodeClientLifetime } from './OpenCodeClientLifetime.ts'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'OpenCodeProviderAdapter'
)
const names = new Set([
  'clientEntries',
  'clientEntryPromises',
  'states',
  'createClientEntry',
  'getClientEntry',
  'withTransientClient',
  'disposeClients',
  'getChats'
])
const code = ts.transpileModule(
  `class Harness { ${declaration.members
    .filter((member) => names.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const servers = []
  const context = vm.createContext({
    AbortController,
    console: { error() {} },
    OpenCodeClientLifetime,
    normalizeStoredContainer: (container) => container ?? null,
    getContainerTargetKey: (container) => container?.name ?? 'host',
    createOpenCodeTerminalTasks: () => ({ dispose() {} }),
    requireData: (result) => result.data,
    isOneShotSession: () => false,
    getOpenCodeV2Client: () => null,
    OpenCodeServerClient: class {
      constructor(container) {
        this.container = container
        this.stops = 0
        this.client = {
          experimental: { session: { list: async () => ({ data: [] }) } },
          session: { status: async () => ({ data: {} }) }
        }
        servers.push(this)
      }
      getClient = async () => this.client
      onExit = (listener) => {
        this.exit = listener
      }
      dispose = async () => {
        this.stops += 1
      }
    }
  })
  vm.runInContext(code, context)
  const adapter = new context.Harness()
  adapter.consumeEvents = () => {}
  adapter.closeBrowser = () => {}
  return { adapter, servers }
}

test('empty discovery stops its server after five seconds and the next lookup starts a fresh one', async (t) => {
  const { adapter, servers } = fixture(t)
  assert.equal((await adapter.getChats()).chats.length, 0)
  const entry = adapter.clientEntries.get('host')
  t.mock.timers.tick(4_999)
  assert.equal(servers[0].stops, 0)
  t.mock.timers.tick(1)
  assert.equal(servers[0].stops, 1)
  assert.equal(adapter.clientEntries.size, 0)
  assert.equal(entry.eventAbortController.signal.aborted, true)
  await adapter.getChats()
  assert.equal(servers.length, 2)
  await adapter.disposeClients()
  t.mock.timers.tick(5_000)
  assert.equal(servers[1].stops, 1, 'shutdown cancels the idle timer')
})

test('overlapping metadata requests share a server and release only after the last request', async (t) => {
  const { adapter, servers } = fixture(t)
  const pending = deferred()
  const started = deferred()
  const reading = adapter.withTransientClient(null, async () => {
    started.resolve()
    return pending.promise
  })
  await started.promise
  await adapter.getChats()
  t.mock.timers.tick(60_000)
  assert.equal(servers.length, 1)
  assert.equal(servers[0].stops, 0)
  pending.resolve('done')
  assert.equal(await reading, 'done')
  t.mock.timers.tick(5_000)
  assert.equal(servers[0].stops, 1)
})

test('an empty history waits for its status request before releasing the server', async (t) => {
  const { adapter, servers } = fixture(t)
  const pending = deferred()
  const started = deferred()
  await adapter.withTransientClient(null, async (entry) => {
    entry.client.session.status = async () => {
      started.resolve()
      return pending.promise
    }
  })
  const reading = adapter.getChats()
  await started.promise
  t.mock.timers.tick(60_000)
  assert.equal(servers[0].stops, 0)
  pending.resolve({ data: {} })
  await reading
  t.mock.timers.tick(5_000)
  assert.equal(servers[0].stops, 1)
})

test('failed discovery releases its lease and later pagination resets the idle deadline', async (t) => {
  const { adapter, servers } = fixture(t)
  await assert.rejects(
    adapter.withTransientClient(null, async () => {
      throw new Error('Failed metadata request')
    }),
    /Failed metadata request/
  )
  t.mock.timers.tick(4_000)
  await adapter.getChats()
  t.mock.timers.tick(4_000)
  assert.equal(servers[0].stops, 0)
  t.mock.timers.tick(1_000)
  assert.equal(servers[0].stops, 1)
})

test('a chat acquiring a discovery server retains it across metadata cleanup', async (t) => {
  const { adapter, servers } = fixture(t)
  await adapter.getChats()
  const entry = await adapter.getClientEntry()
  t.mock.timers.tick(60_000)
  assert.equal(servers.length, 1)
  assert.equal(servers[0].stops, 0)
  assert.equal(entry.eventAbortController.signal.aborted, false)
  await adapter.getChats()
  t.mock.timers.tick(60_000)
  assert.equal(servers[0].stops, 0)
  await adapter.disposeClients()
  assert.equal(servers[0].stops, 1)
})

for (const busy of ['active', 'pendingApprovals', 'pendingQuestions']) {
  test(`discovery preserves ${busy} work while unrelated sources can shut down`, async (t) => {
    const { adapter, servers } = fixture(t)
    const state = {
      container: null,
      active: false,
      pendingApprovals: [],
      pendingQuestions: [],
      [busy]: busy === 'active' ? true : [{}]
    }
    adapter.states.set('chat', state)
    await adapter.getChats()
    await adapter.getChats({ container: { kind: 'container', name: 'other' } })
    t.mock.timers.tick(5_000)
    assert.equal(servers[0].stops, 0)
    assert.equal(servers[1].stops, 1)
    state[busy] = busy === 'active' ? false : []
    t.mock.timers.tick(5_000)
    assert.equal(servers[0].stops, 1)
  })
}

test('server exit cancels scheduled cleanup instead of disposing the exited process later', async (t) => {
  const { adapter, servers } = fixture(t)
  await adapter.getChats()
  servers[0].exit(new Error('Exited'))
  t.mock.timers.tick(5_000)
  assert.equal(servers[0].stops, 0)
  assert.equal(adapter.clientEntries.size, 0)
})
