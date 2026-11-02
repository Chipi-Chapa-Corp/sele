import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

// Exercise native notifications without starting Electron or an authenticated provider.
const source = ts.createSourceFile(
  'CodexProviderAdapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const names = ['handleNotification', 'handleTurnNotification', 'addPendingTurnWithId']
const code = ts.transpileModule(
  `class Adapter { ${declaration.members
    .filter((node) => names.includes(node.name?.getText(source)))
    .map((node) => node.getText(source))
    .join('\n')} }; new Adapter()`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const setup = () => {
  const adapter = vm.runInNewContext(code, {
    getThreadId: (params) => params.threadId,
    isCodexSubagentThread: () => false,
    isCodexAuthenticationFailure: () => false,
    nowSeconds: () => 1
  })
  const turn = { id: 'turn', status: 'inProgress', items: [] }
  const thread = { id: 'chat', promptSuggestionsEnabled: true, turns: [turn] }
  const requests = []
  const updates = []
  Object.assign(adapter, {
    threads: new Map([['chat', thread]]),
    queuedTurnsByThread: new Map(),
    activeTurnIds: new Map([['chat', 'turn']]),
    pendingTurnIds: new Map(),
    pendingApprovalsByThread: new Map(),
    userQuestions: { clearServerTurn() {} },
    client: {
      request: async (method, params) => {
        requests.push({ method, params })
        return {}
      }
    },
    rememberThreadContainer() {},
    normalizeLiveTurn: (turn) => turn,
    isManuallyStoppedTurn: () => false,
    recordSubagentRunOutcome() {},
    isRolledBackTurn: () => false,
    getPendingTurnIdForLiveTurn: () => null,
    applyLiveItemStatus: (item) => item,
    upsertTurn: (_id, turn) => {
      adapter.threads.set('chat', { ...adapter.threads.get('chat'), turns: [turn] })
    },
    getActiveTurnId: (id) => adapter.activeTurnIds.get(id),
    hasActiveOrSubmittingTurn: (id) =>
      adapter.activeTurnIds.has(id) || adapter.pendingTurnIds.has(id),
    setThreadStatus() {},
    retainThreadTurnTail() {},
    removeSteeringMessageForTurn() {},
    hasWaitingSteeringMessageForTurn: () => false,
    scheduleQueueDrain() {},
    scheduleChatUpdated() {},
    emitChatUpdated: (id) => updates.push(id),
    completionCoordinator: { complete: async (_id, options) => options.publish(), cancel() {} },
    reconcileStartedTurn: (_id, _pending, turn) => {
      adapter.threads.set('chat', { ...adapter.threads.get('chat'), turns: [turn] })
    },
    createPendingTurn: (id) => ({ id, status: 'inProgress', items: [] }),
    insertTurnBeforeQueued: (turns, turn) => [...turns, turn],
    cacheThread: (next) => adapter.threads.set(next.id, next)
  })
  adapter.promptSuggestions = new Map([
    [
      adapter.client,
      {
        request: (threadId, sourceTurnId) =>
          adapter.client.request('thread/prediction/request', { threadId, sourceTurnId }),
        cancel() {},
        isTemporaryThread: () => false
      }
    ]
  ])
  const complete = (patch = {}) =>
    adapter.handleNotification({
      method: 'turn/completed',
      params: { threadId: 'chat', turn: { ...turn, status: 'completed', ...patch } }
    })
  const predict = (result = { type: 'completed', text: '  Add tests  ' }, sourceTurnId = 'turn') =>
    adapter.handleNotification({
      method: 'thread/prediction/updated',
      params: {
        threadId: 'chat',
        sourceTurnId,
        result
      }
    })
  return { adapter, thread, requests, updates, complete, predict }
}

test('completed native turns request predictions and publish the matching result', () => {
  const { adapter, requests, updates, complete, predict } = setup()
  complete()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'thread/prediction/request')
  assert.equal(requests[0].params.sourceTurnId, 'turn')
  predict()
  assert.equal(adapter.threads.get('chat').promptSuggestion.text, 'Add tests')
  assert.equal(updates.length, 2)
  assert.equal(
    adapter.threads.get('chat').turns.length,
    1,
    'predictions never add transcript turns'
  )
  predict({ type: 'completed', text: 'Duplicate result' })
  assert.equal(adapter.threads.get('chat').promptSuggestion.text, 'Add tests')
})

test('wrong-turn, active-turn, queued, and failed predictions are ignored', () => {
  for (const condition of ['wrong-turn', 'active', 'queued', 'failed', 'empty']) {
    const { adapter, complete, predict } = setup()
    complete()
    if (condition === 'active') adapter.activeTurnIds.set('chat', 'next')
    if (condition === 'queued') adapter.queuedTurnsByThread.set('chat', [{}])
    predict(
      condition === 'failed'
        ? { type: 'failed' }
        : condition === 'empty'
          ? { type: 'completed', text: null }
          : undefined,
      condition === 'wrong-turn' ? 'old' : 'turn'
    )
    assert.equal(adapter.threads.get('chat').promptSuggestion ?? null, null)
  }
})

test('disabled, failed, interrupted, and queued turns do not request predictions', () => {
  for (const condition of ['disabled', 'failed', 'interrupted', 'queued']) {
    const { adapter, thread, complete, requests } = setup()
    if (condition === 'disabled') thread.promptSuggestionsEnabled = false
    if (condition === 'queued') adapter.queuedTurnsByThread.set('chat', [{}])
    complete(['failed', 'interrupted'].includes(condition) ? { status: condition } : {})
    assert.equal(requests.length, 0)
  }
})

test('unsupported prediction requests leave completed chat usable', async () => {
  const { adapter, complete, predict } = setup()
  adapter.client.request = async () => {
    throw new Error('Unknown method')
  }
  complete()
  await Promise.resolve()
  assert.equal(adapter.threads.get('chat').predictionSourceTurnId, null)
  predict()
  assert.equal(adapter.threads.get('chat').promptSuggestion ?? null, null)
})

test('submitting another prompt clears predictions and rejects the previous turn result', () => {
  const { adapter, complete, predict } = setup()
  complete()
  predict()
  adapter.addPendingTurnWithId('chat', 'next', 'My prompt', { promptSuggestions: false })
  const thread = adapter.threads.get('chat')
  assert.equal(thread.promptSuggestion, null)
  assert.equal(thread.predictionSourceTurnId, null)
  assert.equal(thread.promptSuggestionsEnabled, false)
  predict()
  assert.equal(thread.promptSuggestion, null)
})

test('temporary Desktop fork notifications never create transcript turns or visible usage', () => {
  const { adapter, updates } = setup()
  adapter.promptSuggestions.get(adapter.client).isTemporaryThread = (id) => id === 'temporary'
  for (const method of [
    'turn/started',
    'turn/completed',
    'item/completed',
    'thread/tokenUsage/updated'
  ])
    adapter.handleNotification({
      method,
      params: { threadId: 'temporary', turn: { id: 'prediction', status: 'completed' } }
    })
  assert.deepEqual([...adapter.threads.keys()], ['chat'])
  assert.equal(adapter.threads.get('chat').turns.length, 1)
  assert.equal(updates.length, 0)
})
