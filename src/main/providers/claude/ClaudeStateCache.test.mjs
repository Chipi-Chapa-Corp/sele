import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { normalizeContainerTarget } from '../../containerTarget.ts'
import { ProviderConversationCompletionCoordinator } from '../ProviderConversationEngine.ts'

const source = ts.createSourceFile(
  'ClaudeProviderAdapter.ts',
  readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const adapter = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'ClaudeProviderAdapter'
)
const methods = new Set([
  'createState',
  'rememberStateTranscriptSize',
  'pinState',
  'unpinState',
  'leaseStateForAdmission',
  'isStateBusy',
  'touchState',
  'trimIdleStates',
  'ensureState',
  'getChat',
  'continueChat',
  'queueUpdate',
  'scheduleSessionMetadataRefresh',
  'emitUpdate',
  'publishUpdate',
  'consumeStateQuery',
  'closeStateQuery',
  'startStateQuery',
  'dispose'
])
const code = ts.transpileModule(
  `class Harness { ${adapter.members
    .filter((member) => methods.has(member.name?.getText(source)))
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
const settleAdmissions = () => new Promise((resolve) => setTimeout(resolve, 10))

const makeHarness = ({ records = () => [], metadata = () => null } = {}) => {
  const loads = new Map()
  let queryCreations = 0
  const context = vm.createContext({
    normalizeContainerTarget,
    maxIdleSessionStates: 8,
    maxIdleTranscriptBytes: 32 * 1024 * 1024,
    updateDelayMs: 1,
    sessionTitleRefreshDelayMs: 10_000,
    ClaudeRemoteSessionStore: class {
      constructor(container) {
        this.container = container
      }
    },
    getSessionInfo: async (id, options) => metadata(id, options),
    loadClaudeHistory: async (id, store) => {
      loads.set(id, (loads.get(id) ?? 0) + 1)
      return records(id, store)
    },
    isExpectedClaudeQueryShutdownError: () => true,
    AsyncMessageQueue: class {
      close() {}
    },
    getBrowserAutomationService: () => null,
    getClaudeModel: () => undefined,
    query: () => {
      queryCreations += 1
      return { close() {} }
    },
    claudeAccounts: { dispose() {} },
    console,
    setTimeout,
    clearTimeout
  })
  vm.runInContext(code, context)
  const instance = new context.Harness()
  Object.assign(instance, {
    states: new Map(),
    stateLoads: new Map(),
    stateGeneration: 0,
    disposed: false,
    pinnedStates: new Map(),
    completingStates: new Set(),
    stateTranscriptBytes: new WeakMap(),
    admissionLeases: new Map(),
    sessionContainers: new Map(),
    sessionOptions: new Map(),
    transcriptProjections: new Map(),
    updateTimers: new Map(),
    metadataRefreshTimers: new Map(),
    completionCoordinator: new ProviderConversationCompletionCoordinator(),
    chatUpdatedListeners: new Set(),
    hiddenSessionIds: new Set(),
    sessionDiscovery: { dispose() {} },
    oneShotGenerations: new Map(),
    canceledOneShotGenerationTimers: new Map(),
    canceledOneShotGenerationIds: new Set(),
    resumeDropsTurnSupport: new Map(),
    modelDiscoveryRequests: new Map(),
    controlQueries: { dispose() {} },
    createChatDetail: (state) => ({
      id: state.id,
      messages: state.messages,
      container: state.container
    }),
    handleQueryEvent: async () => true,
    rejectPendingRequests: () => {},
    getQueryRuntime: async () => ({ container: null }),
    getBaseQueryOptions: () => ({}),
    createPermissionHandler: () => () => ({})
  })
  return {
    instance,
    loads,
    context,
    get queryCreations() {
      return queryCreations
    }
  }
}

const record = (id, size = 100) => ({
  type: 'user',
  uuid: `${id}-message`,
  session_id: id,
  message: { role: 'user', content: 'x'.repeat(size) },
  parent_tool_use_id: null
})

test('real getChat admission bounds visited transcripts and reopens the least recent session', async () => {
  const { instance: h, loads } = makeHarness({ records: (id) => [record(id)] })
  for (let i = 0; i < 8; i++) await h.getChat(`chat-${i}`)
  const first = h.states.get('chat-0')
  const evicted = h.states.get('chat-1')
  h.transcriptProjections.set(first, { large: 'derived history' })
  h.transcriptProjections.set(evicted, { large: 'derived history' })
  await h.getChat('chat-0') // Refresh LRU recency through the public adapter path.
  await h.getChat('chat-8')
  await settleAdmissions()
  assert.equal(h.states.size, 8)
  assert.equal(h.states.has('chat-0'), true)
  assert.equal(h.states.has('chat-1'), false)
  assert.equal(h.transcriptProjections.has(evicted), false)
  const old = await h.getChat('chat-1')
  assert.equal(old.messages[0].message.content, 'x'.repeat(100))
  assert.equal(loads.get('chat-1'), 2)
  await settleAdmissions()
  assert.equal(h.states.size, 8)
  h.dispose()
})

test('simultaneous admissions stay current through reads and sends, then trim after callers resume', async () => {
  const { instance: h } = makeHarness({ records: (id) => [record(id)] })
  h.createChatDetail = (state) => {
    assert.equal(h.states.get(state.id), state, 'caller received an already evicted state')
    return { id: state.id }
  }
  await Promise.all(Array.from({ length: 24 }, (_, i) => h.getChat(`read-${i}`)))
  assert.equal(h.states.size, 24)
  await settleAdmissions()
  assert.equal(h.states.size, 8)

  h.sendMessageRespectingQueue = async (state) => {
    assert.equal(h.states.get(state.id), state, 'send started from an evicted state')
    state.queuedMessages.push({ id: 'pending' })
  }
  await Promise.all(Array.from({ length: 16 }, (_, i) => h.continueChat(`send-${i}`, 'go')))
  for (let i = 0; i < 16; i++) assert.equal(h.states.get(`send-${i}`).queuedMessages.length, 1)
  h.dispose()
})

test('size accounting traverses large records without serializing their content', async () => {
  const { instance: h, context } = makeHarness({ records: (id) => [record(id, 3_000_000)] })
  context.JSON = {
    stringify() {
      assert.fail('history must not be serialized for cache sizing')
    }
  }
  await h.getChat('large')
  assert.ok(h.stateTranscriptBytes.get(h.states.get('large')) > 5_000_000)
  h.dispose()
})

test('large inactive chats are bounded by transcript bytes, and remote container survives reopen', async () => {
  const container = { kind: 'container', tool: 'ssh', name: 'remote' }
  const stores = []
  const { instance: h, loads } = makeHarness({
    records: (id, store) => {
      stores.push(store?.container ?? null)
      return [record(id, 2_300_000)]
    }
  })
  h.sessionContainers.set('chat-0', container)
  for (let i = 0; i < 18; i++) await h.getChat(`chat-${i}`)
  await settleAdmissions()
  assert.ok(h.states.size <= 8)
  assert.ok(h.states.size <= 7, 'transcript byte budget should evict before the count limit')
  assert.equal(h.states.has('chat-0'), false)
  const reopened = await h.getChat('chat-0')
  assert.equal(reopened.messages.length, 1)
  assert.equal(reopened.container.name, 'remote')
  assert.equal(loads.get('chat-0'), 2)
  assert.deepEqual(
    stores.filter(Boolean).map((store) => store.name),
    ['remote', 'remote']
  )
  h.dispose()
})

test('evicted sessions keep query settings without retaining one-turn attachments', async () => {
  const { instance: h } = makeHarness({ records: (id) => [record(id)] })
  const original = h.createState('configured', {
    model: 'claude-sonnet',
    sandboxMode: 'read-only',
    cwd: '/workspace',
    files: [{ path: '/workspace/huge.txt' }],
    skills: [{ name: 'special', path: '/skills/special' }]
  })
  original.messages = [record('configured')]
  h.rememberStateTranscriptSize(original)
  h.states.set(original.id, original)
  for (let i = 0; i < 9; i++) await h.getChat(`other-${i}`)
  await settleAdmissions()
  assert.equal(h.states.has('configured'), false)
  assert.equal(h.sessionOptions.get('configured').files, undefined)
  assert.equal(h.sessionOptions.get('configured').skills, undefined)
  await h.getChat('configured')
  const restored = h.states.get('configured')
  assert.equal(restored.options.model, 'claude-sonnet')
  assert.equal(restored.options.sandboxMode, 'read-only')
  assert.equal(restored.cwd, '/workspace')
  h.dispose()
})

test('active work, approvals, questions, queued messages, drains, background tasks, and completion stay pinned', async () => {
  const { instance: h } = makeHarness({ records: (id) => [record(id)] })
  const protectedStates = []
  for (let i = 0; i < 9; i++) protectedStates.push(h.createState(`p-${i}`))
  protectedStates[0].query = { close() {} }
  protectedStates[1].active = true
  protectedStates[2].pendingApprovals.push({ id: 'approval' })
  protectedStates[3].pendingUserInputs.push({ id: 'question' })
  protectedStates[4].queuedMessages.push({ id: 'queued' })
  protectedStates[5].queueDrainInProgress = true
  protectedStates[6].backgroundTaskIds.add('task')
  protectedStates[7].waitingForSessionIdle = true
  h.completingStates.add(protectedStates[8])
  for (const state of protectedStates) h.states.set(state.id, state)
  for (let i = 0; i < 16; i++) await h.getChat(`idle-${i}`)
  await settleAdmissions()
  for (const state of protectedStates) assert.equal(h.states.get(state.id), state)
  assert.ok(h.states.size <= protectedStates.length + 8)
  h.dispose()
})

test('eviction releases projections and metadata timers; finished queries become evictable', async () => {
  const { instance: h } = makeHarness({ records: (id) => [record(id)] })
  const state = h.createState('new-session')
  h.states.set(state.id, state)
  h.transcriptProjections.set(state, { source: state.messages })
  h.scheduleSessionMetadataRefresh(state)
  let closed = false
  const control = {
    close() {
      closed = true
    },
    async *[Symbol.asyncIterator]() {
      yield { type: 'result' }
    }
  }
  state.query = control
  state.input = { close() {} }
  await h.consumeStateQuery(state, control)
  assert.equal(closed, true)
  assert.equal(state.query, null)
  for (let i = 0; i < 9; i++) await h.getChat(`older-${i}`)
  await settleAdmissions()
  assert.equal(h.states.has(state.id), false)
  assert.equal(h.transcriptProjections.has(state), false)
  assert.equal(h.metadataRefreshTimers.has(state.id), false)
  h.dispose()
})

test('concurrent opens share one history read and dispose rejects late loads', async () => {
  const gate = deferred()
  const { instance: h, loads } = makeHarness({
    records: async (id) => {
      await gate.promise
      return [record(id)]
    }
  })
  const first = h.getChat('shared')
  const second = h.getChat('shared')
  await Promise.resolve()
  assert.equal(loads.get('shared'), 1)
  gate.resolve()
  const [one, two] = await Promise.all([first, second])
  assert.equal(one.messages, two.messages)
  h.dispose()

  const late = deferred()
  const other = makeHarness({
    records: async (id) => {
      await late.promise
      return [record(id)]
    }
  }).instance
  const pending = other.getChat('late')
  other.dispose()
  late.resolve()
  await assert.rejects(pending, /disposed/)
  assert.equal(other.states.size, 0)
})

test('nested and concurrent startup pins release only their own lease', async () => {
  const h = makeHarness().instance
  const state = h.createState('nested')
  h.states.set(state.id, state)
  h.consumeStateQuery = async () => {}
  const gate = deferred()
  h.getQueryRuntime = async () => gate.promise
  h.pinState(state) // An edit or title change owns an outer lease.
  const first = h.startStateQuery(state)
  const second = h.startStateQuery(state)
  await Promise.resolve()
  gate.resolve({ container: null })
  await assert.rejects(first, /canceled/)
  await second
  assert.equal(h.pinnedStates.get(state), 1, 'startup must leave the outer lease held')
  await h.closeStateQuery(state)
  assert.equal(h.isStateBusy(state), true)
  h.unpinState(state)
  assert.equal(h.isStateBusy(state), false)
  h.dispose()
})

test('disposing while query runtime resolves cannot create or resurrect a query', async () => {
  const harness = makeHarness()
  const h = harness.instance
  const state = h.createState('starting')
  h.states.set(state.id, state)
  h.consumeStateQuery = async () => {}
  const gate = deferred()
  h.getQueryRuntime = async () => gate.promise
  const pending = h.startStateQuery(state)
  await Promise.resolve()
  h.dispose()
  gate.resolve({ container: null })
  await assert.rejects(pending, /canceled/)
  assert.equal(harness.queryCreations, 0)
  assert.equal(state.query, null)
  assert.equal(h.states.size, 0)
})
