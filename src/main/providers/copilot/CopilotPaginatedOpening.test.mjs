import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { CopilotHistoryPages } from './CopilotHistoryPages.ts'
import * as renderers from './CopilotItemRenderers.ts'
import { reconcileProviderRecords } from '../ProviderConversationEngine.ts'
import { getProviderChatTurns, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget.ts'
import * as subagents from './CopilotSubagents.ts'

const event = (i, type, data, agentId) => ({
  id: `event-${i}`,
  type,
  data,
  agentId,
  timestamp: new Date(1_000_000 + i).toISOString(),
  parentId: null
})
const records = (count, pad = '') =>
  Array.from({ length: count }, (_, i) => [
    event(i * 2, 'user.message', { content: `Question ${i}` }),
    event(i * 2 + 1, 'assistant.message', {
      content: `Answer ${i}${pad}`,
      messageId: `message-${i}`
    })
  ]).flat()
const transport = (history) => {
  const requests = [],
    hooks = {}
  const session = {
    rpc: {
      eventLog: {
        read: async (params) => {
          requests.push(params)
          assert.ok(params.max <= 64)
          assert.equal(params.direction, 'backward')
          const scoped = history
            .filter((e) =>
              params.agentIds
                ? params.agentIds.includes(e.agentId)
                : params.agentScope === 'all' || !e.agentId || e.type.startsWith('subagent.')
            )
            .filter((e) => !Array.isArray(params.types) || params.types.includes(e.type))
          const end = params.cursor
            ? scoped.findIndex((e) => `opaque:${e.id}` === params.cursor)
            : scoped.length
          assert.ok(end >= 0)
          const start = Math.max(0, end - params.max)
          const result = {
            events: structuredClone(scoped.slice(start, end)),
            hasMore: start > 0,
            cursor: start ? `opaque:${scoped[start].id}` : 'end',
            cursorStatus: 'ok'
          }
          await hooks.beforeResponse?.()
          return result
        }
      },
      tasks: { list: async () => ({ tasks: [] }) }
    },
    getEvents: async () => assert.fail('opening and scrolling must never request every event')
  }
  return { session, requests, history, hooks }
}
const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./CopilotProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'CopilotProviderAdapter'
)
const names = new Set([
  'createState',
  'getSessionContainer',
  'ensureSession',
  'checkSessionMetadata',
  'loadEvents',
  'getChatWindow',
  'getChatCursorWindow',
  'getChatWindowForItem',
  'createChatDetail',
  'getSubagents',
  'getSubagent',
  'getSubagentWindowForItem',
  'getSidebarTurnSummary',
  'restorePendingMessages'
])
const code = ts.transpileModule(
  `class Harness { ${declaration.members
    .filter((m) => names.has(m.name?.getText(source)))
    .map((m) => m.getText(source))
    .join('\n')} }; globalThis.Harness=Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const harness = (history = records(1000, 'x'.repeat(4096))) => {
  const t = transport(history)
  const metadata = {
    sessionId: 'chat',
    modifiedTime: 1,
    startTime: 1,
    summary: 'Saved name',
    context: { workingDirectory: '/fixture' }
  }
  const client = {
    getSessionMetadata: async () => ({ ...metadata }),
    resumeSession: async () => t.session
  }
  const context = vm.createContext({
    ...renderers,
    ...subagents,
    Date,
    console,
    getContainerTargetKey,
    normalizeContainerTarget,
    getCopilotCustomProviderSessionOptions: () => ({}),
    normalizeReasoningEffort: () => null,
    getProviderChatTurns,
    sliceProviderChatTurns,
    reconcileProviderRecords,
    toMilliseconds: (value) => (typeof value === 'string' ? Date.parse(value) : Number(value)),
    restoredMessageClockSkewMs: 5000,
    getContextUsage: () => null,
    isUnsupportedCopilotMethodError: () => false
  })
  vm.runInContext(code, context)
  const instance = Object.assign(new context.Harness(), {
    states: new Map(),
    clientsWithoutPersistedEvents: new WeakSet(),
    sessionContainers: new Map(),
    sessionLoads: new WeakMap(),
    metadataChecks: new WeakMap(),
    eventStores: new WeakMap(),
    historyPages: new CopilotHistoryPages(),
    sessionModels: new WeakMap(),
    subagentFollowUps: new WeakMap(),
    ensureClient: async () => client,
    closeBrowserIntegration() {},
    createBrowserIntegration: async () => null,
    browserBindingMatches: () => true,
    addAdditionalDirectories: async () => {},
    loadSessionTitle: async () => {},
    createElicitationHandler: () => () => {},
    pendingMessageStore: { restore: async () => [] },
    persistPendingMessages() {},
    refreshPendingMessages: async () => {},
    refreshPlan: async () => {},
    refreshGoal: async () => {},
    getTitle: () => 'Saved name',
    getCwd: () => '/fixture',
    getPendingApproval: () => null,
    getPendingUserInput: () => null
  })
  return { ...t, instance, metadata }
}

test('cold opening uses a bounded native event-log page through the actual adapter', async () => {
  const h = harness(),
    a = h.instance
  const detail = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.equal(detail.turnPagination.kind, 'cursor')
  assert.ok(h.requests.length <= 2)
  assert.ok(a.states.get('chat').events.length <= 65)
  assert.ok(detail.items.some((i) => i.content?.startsWith('Answer 999')))
  const tail = a.states.get('chat').events
  const older = await a.getChatCursorWindow('chat', {
    cursor: detail.turnPagination.olderCursor,
    direction: 'older',
    limit: 10
  })
  assert.ok(older.turnPagination.newerCursor)
  const newer = await a.getChatCursorWindow('chat', {
    cursor: older.turnPagination.newerCursor,
    direction: 'newer',
    limit: 10
  })
  assert.deepEqual(newer.items, detail.items)
  assert.equal(a.states.get('chat').events, tail)
})

test('native cursor pages reconstruct every record across overlap, short pages and appends', async () => {
  const original = records(83),
    h = transport([...original]),
    pages = new CopilotHistoryPages()
  let page = await pages.read(h.session, { cursor: null, direction: 'older', limit: 3 })
  let all = page.events
  h.history.push(...records(100).slice(166))
  while (page.pagination.olderCursor) {
    page = await pages.read(h.session, {
      cursor: page.pagination.olderCursor,
      direction: 'older',
      limit: 3
    })
    all = [...page.events, ...all]
  }
  assert.deepEqual(all, original)
})

test('external updates and numeric exports do not hydrate or replace the runtime prefix', async () => {
  const h = harness(),
    a = h.instance
  await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  h.history.push(...records(1001).slice(2000))
  h.metadata.modifiedTime++
  const updated = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.ok(updated.items.some((i) => i.content === 'Answer 1000'))
  const state = a.states.get('chat'),
    tail = state.events,
    pagination = state.historyPagination
  const exported = await a.getChatWindow('chat', { startIndex: 0, limit: Number.MAX_SAFE_INTEGER })
  assert.equal(getProviderChatTurns(exported.items).length, 1001)
  assert.equal(state.events, tail)
  assert.equal(state.historyPagination, pagination)
})

test('history refresh preserves live replacements received during a native page read', async () => {
  const h = harness(),
    a = h.instance
  await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  const state = a.states.get('chat')
  h.hooks.beforeResponse = () => {
    delete h.hooks.beforeResponse
    state.events = state.events.map((e) =>
      e.id === 'event-1999' ? { ...e, data: { ...e.data, content: 'Live answer' } } : e
    )
  }
  h.metadata.modifiedTime++
  const detail = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.ok(detail.items.some((i) => i.content === 'Live answer'))
})

test('child pages use agent filtering and do not load an entire long tool run', async () => {
  const child = Array.from({ length: 1000 }, (_, i) =>
    event(
      i,
      'assistant.message',
      {
        content: `Child answer ${i}`,
        messageId: `child-message-${i}`
      },
      'child'
    )
  )
  const h = transport(child),
    pages = new CopilotHistoryPages()
  const latest = await pages.read(
    h.session,
    { cursor: null, direction: 'older', limit: 10 },
    'child'
  )
  assert.ok(latest.events.length <= 65)
  assert.ok(latest.pagination.olderCursor)
  assert.ok(h.requests.every((p) => p.agentIds?.[0] === 'child'))
  const older = await pages.read(
    h.session,
    { cursor: latest.pagination.olderCursor, direction: 'older', limit: 10 },
    'child'
  )
  assert.ok(older.events.at(-1).id !== latest.events.at(-1).id)
  await assert.rejects(
    pages.read(
      h.session,
      { cursor: latest.pagination.olderCursor, direction: 'older', limit: 10 },
      'other'
    ),
    /cursor expired/
  )
})

test('expired provider cursors fail instead of publishing an incomplete terminal page', async () => {
  const h = transport(records(20)),
    pages = new CopilotHistoryPages()
  h.session.rpc.eventLog.read = async () => ({
    events: [],
    cursor: 'expired',
    hasMore: false,
    cursorStatus: 'expired'
  })
  await assert.rejects(
    pages.read(h.session, { cursor: null, direction: 'older', limit: 10 }),
    /cursor expired/
  )
})

test('opening a long main-agent tool run reads a bounded tail without its original prompt', async () => {
  const h = harness([
    records(1)[0],
    ...Array.from({ length: 1000 }, (_, i) =>
      event(i + 1, 'assistant.message', { content: `Answer ${i}`, messageId: `msg-${i}` })
    )
  ])
  const detail = await h.instance.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.ok(h.requests.length <= 2)
  assert.ok(detail.turnPagination.olderCursor)
  assert.ok(h.instance.states.get('chat').events.length <= 65)
})

test('a sidebar status preview cannot scan a tool run to find its first prompt', async () => {
  const h = harness()
  let reads = 0
  const result = await h.instance.getSidebarTurnSummary(
    {
      rpc: {
        sessions: {
          readPersistedEvents: async () => {
            reads++
            return {
              events: [event(1, 'tool.execution_complete', { toolCallId: 'tool', success: true })],
              hasMore: true,
              cursor: 'older',
              cursorStatus: 'ok'
            }
          }
        }
      }
    },
    'chat'
  )
  assert.equal(reads, 1)
  assert.equal(result, undefined)
})

test('child tool expansion finds the original cursor after a newer task event arrives', async () => {
  const history = [
    ...records(1),
    event(
      10,
      'subagent.started',
      {
        agentName: 'child',
        agentDisplayName: 'Child',
        agentDescription: 'Task',
        toolCallId: 'spawn'
      },
      'child'
    ),
    ...Array.from({ length: 1000 }, (_, i) =>
      event(
        11 + i,
        'tool.execution_start',
        {
          toolCallId: `tool-${i}`,
          toolName: 'bash',
          arguments: { command: `echo ${i}` }
        },
        'child'
      )
    )
  ]
  const h = harness(history),
    a = h.instance
  const page = await a.getSubagent('chat', 'child')
  const working = page.items.find((item) => item.type === 'working')
  assert.ok(working)
  h.history.push(
    event(
      1011,
      'tool.execution_start',
      { toolCallId: 'tool-new', toolName: 'bash', arguments: { command: 'echo new' } },
      'child'
    )
  )
  await a.getSubagent('chat', 'child')
  const expanded = await a.getSubagentWindowForItem('chat', 'child', working.id)
  assert.ok(expanded.items.some((item) => item.id === working.id))
})

test('pending input deduplication queries user records without loading tool output', async () => {
  const h = transport(records(1000)),
    pages = new CopilotHistoryPages()
  const inputs = await pages.inputsSince(h.session, Date.parse(h.history.at(-100).timestamp))
  assert.ok(inputs.length > 0)
  assert.ok(inputs.every((event) => event.type === 'user.message'))
  assert.ok(h.requests.every((request) => request.types?.[0] === 'user.message'))
  assert.ok(h.requests.length <= 2)
})

test('submitted messages outside the displayed tail are not restored as sendable duplicates', async () => {
  const h = harness(),
    a = h.instance
  const original = h.history[0]
  a.pendingMessageStore.restore = async () => [
    {
      id: 'pending-old',
      kind: 'steering',
      submitted: true,
      createdAt: Date.parse(original.timestamp),
      payload: {
        type: 'pendingMessage',
        id: 'pending-old',
        kind: 'steering',
        content: original.data.content,
        delivery: 'submitting'
      }
    }
  ]
  await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.equal(a.states.get('chat').pendingMessages.length, 0)
  assert.ok(h.requests.some((request) => request.types?.[0] === 'user.message'))
  assert.ok(a.states.get('chat').events.length <= 65)
})
