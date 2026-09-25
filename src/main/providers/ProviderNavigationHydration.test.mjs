import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { reconcileProviderRecords } from './ProviderConversationEngine.ts'

const adapterHarness = (provider, name, methods, globals = {}) => {
  const source = ts.createSourceFile(
    `${name}ProviderAdapter.ts`,
    readFileSync(new URL(`./${provider}/${name}ProviderAdapter.ts`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name.text === `${name}ProviderAdapter`
  )
  const code = ts.transpileModule(
    `class Harness { ${declaration.members
      .filter((member) => methods.includes(member.name?.getText(source)))
      .map((member) => member.getText(source))
      .join('\n')} }; globalThis.Harness = Harness`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText
  const context = vm.createContext({ reconcileProviderRecords, ...globals })
  vm.runInContext(code, context)
  return new context.Harness()
}

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const copilotState = () => ({
  id: 'chat',
  container: null,
  client: null,
  session: null,
  metadata: null,
  events: [],
  active: false
})

const copilotHarness = (state, client) => {
  const adapter = adapterHarness(
    'copilot',
    'Copilot',
    [
      'ensureSession',
      'checkSessionMetadata',
      'loadEvents',
      'getChatWindow',
      'getChatWindowForItem'
    ],
    {
      toMilliseconds: (value) => (value instanceof Date ? value.getTime() : Number(value)),
      normalizeReasoningEffort: () => null,
      findCopilotItemTurnWindow: () => ({ startIndex: 20, limit: 10 })
    }
  )
  Object.assign(adapter, {
    sessionLoads: new WeakMap(),
    metadataChecks: new WeakMap(),
    eventStores: new WeakMap(),
    createState: () => state,
    getSessionContainer: () => null,
    ensureClient: async () => client,
    addAdditionalDirectories: async () => {},
    loadSessionTitle: async () => {},
    refreshPendingMessages: async () => {},
    refreshPlan: async () => {},
    createChatDetail: (current) => ({ count: current.events.length })
  })
  return adapter
}

test('Copilot navigation shares first hydration and reuses it across pages', async () => {
  const history = Array.from({ length: 10_000 }, (_, index) => ({
    id: String(index),
    timestamp: index
  }))
  let metadataTime = 1
  let reads = 0
  let resumes = 0
  const session = {
    getEvents: async () => {
      reads++
      return history
    }
  }
  const client = {
    getSessionMetadata: async () => ({ sessionId: 'chat', modifiedTime: metadataTime }),
    resumeSession: async () => {
      resumes++
      return session
    }
  }
  const adapter = copilotHarness(copilotState(), client)
  const pages = await Promise.all(
    Array.from({ length: 4 }, () => adapter.getChatWindow('chat', { startIndex: 9_990, limit: 10 }))
  )
  assert.equal(resumes, 1)
  assert.equal(reads, 1)
  assert.equal(pages[0].count, 10_000)
  for (const startIndex of [10, 100, 9_990, 20, 9_980]) {
    await adapter.getChatWindow('chat', { startIndex, limit: 10 })
  }
  await adapter.getChatWindowForItem('chat', 'tool', 10)
  assert.equal(reads, 1)
  metadataTime = 2
  history.push({ id: 'external', timestamp: 10_001 })
  assert.equal((await adapter.getChatWindow('chat', { startIndex: null, limit: 10 })).count, 10_001)
  assert.equal(reads, 2)
  await adapter.getChatWindow('chat', { startIndex: 1, limit: 10 })
  assert.equal(reads, 2)
})

test('Copilot in-flight authoritative snapshot retains later live event replacements', async () => {
  const pending = deferred()
  const state = copilotState()
  state.session = { getEvents: () => pending.promise }
  state.events = [{ id: 'same', timestamp: 1, value: 'old' }]
  const adapter = copilotHarness(state, {})
  const loading = adapter.loadEvents(state)
  state.events = [{ id: 'same', timestamp: 2, value: 'live' }]
  pending.resolve([{ id: 'same', timestamp: 1, value: 'persisted' }])
  await loading
  assert.equal(state.events[0].value, 'live')
})

test('Copilot missing session invalidates the active handle', async () => {
  const state = copilotState()
  let exists = true
  const client = {
    getSessionMetadata: async () => (exists ? { sessionId: 'chat', modifiedTime: 1 } : null),
    resumeSession: async () => ({ getEvents: async () => [] })
  }
  const adapter = copilotHarness(state, client)
  await adapter.getChatWindow('chat', { startIndex: null, limit: 10 })
  exists = false
  await assert.rejects(
    adapter.getChatWindow('chat', { startIndex: null, limit: 10 }),
    /session was not found/
  )
  assert.equal(state.session, null)
})

const openCodeState = () => ({
  id: 'chat',
  directory: '/tmp',
  container: null,
  session: { id: 'chat', directory: '/tmp', time: { updated: 1 } },
  messages: [],
  messagesHydrated: false,
  messagesDirty: false,
  hydratedUpdatedAt: null,
  eventRevision: 0,
  client: null,
  active: false,
  pendingApprovals: [],
  pendingQuestions: []
})

const openCodeHarness = (state, client) => {
  const adapter = adapterHarness(
    'opencode',
    'OpenCode',
    [
      'ensureState',
      'loadMessages',
      'refreshState',
      'refreshStateNow',
      'getChatWindow',
      'getChatWindowForItem',
      'getSubagent',
      'getChats'
    ],
    {
      requireData: (result) => result.data,
      isOneShotSession: () => false,
      getContainerTargetKey: () => 'host',
      normalizeStoredContainer: (container) => container ?? null,
      findOpenCodeItemTurnWindow: () => ({ startIndex: 20, limit: 10 }),
      createOpenCodeSubagentSummary: (session) => ({ id: session.id, status: 'completed' })
    }
  )
  Object.assign(adapter, {
    states: new Map([['chat', state]]),
    sessionContainers: new Map(),
    sessionDiscoveries: new Map(),
    refreshes: new WeakMap(),
    stateChecks: new WeakMap(),
    getClientEntry: async () => ({ client, container: null }),
    createChatDetailFromState: (current) => ({ count: current.messages.length }),
    rememberSession: (session) => {
      state.session = session
      return state
    },
    createChat: (_session, messages) => ({ previewCount: messages.length })
  })
  return adapter
}

test('OpenCode navigation hydrates once, then detects external changes with session metadata', async () => {
  const messages = Array.from({ length: 10_000 }, (_, index) => ({
    info: { id: String(index) },
    parts: []
  }))
  let updated = 1
  let reads = 0
  let gets = 0
  const session = { id: 'chat', directory: '/tmp', time: { updated } }
  const client = {
    session: {
      get: async () => {
        gets++
        return { data: { ...session, time: { updated } } }
      },
      messages: async () => {
        reads++
        return { data: messages }
      },
      status: async () => ({ data: {} })
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) }
  }
  const state = openCodeState()
  const adapter = openCodeHarness(state, client)
  const pages = await Promise.all(
    Array.from({ length: 4 }, () => adapter.getChatWindow('chat', { startIndex: 9_990, limit: 10 }))
  )
  assert.equal(reads, 1)
  assert.equal(pages[0].count, 10_000)
  for (const startIndex of [10, 100, 9_990, 20, 9_980]) {
    await adapter.getChatWindow('chat', { startIndex, limit: 10 })
  }
  await adapter.getChatWindowForItem('chat', 'tool', 10)
  assert.equal(reads, 1)
  assert.ok(gets >= 1)
  updated = 2
  messages.push({ info: { id: 'external' }, parts: [] })
  assert.equal((await adapter.getChatWindow('chat', { startIndex: null, limit: 10 })).count, 10_001)
  assert.equal(reads, 2)
  await adapter.getChatWindow('chat', { startIndex: 1, limit: 10 })
  assert.equal(reads, 2)
})

test('OpenCode sidebar previews request bounded tails without hydrating conversation state', async () => {
  const state = openCodeState()
  let requestedLimit
  const client = {
    experimental: { session: { list: async () => ({ data: [state.session] }) } },
    session: {
      messages: async ({ limit }) => {
        requestedLimit = limit
        return {
          data: Array.from({ length: limit }, (_, index) => ({
            info: { id: String(index) },
            parts: []
          }))
        }
      }
    }
  }
  const adapter = openCodeHarness(state, client)
  const page = await adapter.getChats({ limit: 1 })
  assert.equal(requestedLimit, 8)
  assert.equal(page.chats[0].previewCount, 8)
  assert.equal(state.messagesHydrated, false)
  assert.equal(state.messages.length, 0)
})

test('OpenCode failed or reconnected hydration retries and does not reuse stale messages', async () => {
  const state = openCodeState()
  let reads = 0
  let fail = true
  const makeClient = () => ({
    session: {
      get: async () => ({ data: state.session }),
      messages: async () => {
        reads++
        if (fail) throw new Error('offline')
        return { data: [{ info: { id: String(reads) }, parts: [] }] }
      },
      status: async () => ({ data: {} })
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) }
  })
  const firstClient = makeClient()
  const adapter = openCodeHarness(state, firstClient)
  await assert.rejects(adapter.getChatWindow('chat', { startIndex: null, limit: 10 }), /offline/)
  assert.equal(state.messagesHydrated, false)
  fail = false
  await adapter.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.equal(reads, 2)
  adapter.getClientEntry = async () => ({ client: makeClient(), container: null })
  await adapter.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.equal(reads, 3)
})

test('OpenCode event during hydration leaves state dirty for a follow-up reconciliation', async () => {
  const state = openCodeState()
  const pending = deferred()
  const client = {
    session: {
      get: async () => ({ data: state.session }),
      messages: async () => pending.promise,
      status: async () => ({ data: {} })
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) }
  }
  const adapter = openCodeHarness(state, client)
  const loading = adapter.refreshState(state, client)
  state.eventRevision++
  state.active = true
  state.pendingApprovals = [{ id: 'new-approval' }]
  state.pendingQuestions = [{ id: 'new-question' }]
  pending.resolve({ data: [{ info: { id: 'old' }, parts: [] }] })
  await loading
  assert.equal(state.messagesDirty, true)
  assert.equal(state.active, true)
  assert.equal(state.pendingApprovals[0].id, 'new-approval')
  assert.equal(state.pendingQuestions[0].id, 'new-question')
})

test('OpenCode subagent polls and older pages reuse hydrated history', async () => {
  const state = openCodeState()
  let reads = 0
  const client = {
    session: {
      get: async () => ({ data: state.session }),
      messages: async () => {
        reads++
        return {
          data: Array.from({ length: 10_000 }, (_, index) => ({
            info: { id: String(index) },
            parts: []
          }))
        }
      },
      status: async () => ({ data: {} })
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) }
  }
  const adapter = openCodeHarness(state, client)
  adapter.loadSubagentSessions = async () => [state.session]
  // Parent is already loaded; exercise the actual child ensureState path.
  const ensureState = adapter.ensureState
  adapter.ensureState = (id, container) =>
    id === 'parent'
      ? Promise.resolve({ session: { id: 'parent' }, container: null })
      : ensureState(id, container)
  for (const startIndex of [null, null, 100, 200, null]) {
    await adapter.getSubagent('parent', 'chat', {}, { startIndex, limit: 10 })
  }
  assert.equal(reads, 1)
})

test('OpenCode concurrent first reads share session discovery', async () => {
  const state = openCodeState()
  const discovery = deferred()
  let discoveries = 0
  let reads = 0
  const client = {
    session: {
      get: async () => ({ data: state.session }),
      messages: async () => {
        reads++
        return { data: [] }
      },
      status: async () => ({ data: {} })
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) }
  }
  const adapter = openCodeHarness(state, client)
  adapter.states.clear()
  adapter.findSession = async () => {
    discoveries++
    return discovery.promise
  }
  adapter.rememberSession = () => {
    adapter.states.set('chat', state)
    return state
  }
  const first = adapter.getChatWindow('chat', { startIndex: null, limit: 10 })
  const second = adapter.getChatWindow('chat', { startIndex: 1, limit: 10 })
  discovery.resolve(state.session)
  await Promise.all([first, second])
  assert.equal(discoveries, 1)
  assert.equal(reads, 1)
})
