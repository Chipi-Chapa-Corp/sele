import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getCodexQueueDrainDecision } from './CodexQueueDrain.ts'
import { isCodexTurnTerminal } from './CodexLiveMerge.ts'

const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const methods = [
  'getQueueDrainDecision',
  'getActiveTurnId',
  'hasActiveOrSubmittingTurn',
  'drainNextQueuedTurn',
  'reconcileIdleThreadForQueueDrain',
  'startSubmittedCodexTurn'
]
const code = ts.transpile(
  `class Adapter { ${declaration.members
    .filter((node) => methods.includes(node.name?.getText(source)))
    .map((node) => node.getText(source))
    .join('\n')} }; new Adapter()`,
  { target: ts.ScriptTarget.ES2022 }
)

const fixture = (status = 'idle', turnStatus = 'completed') => {
  const authoritativeTurns = [{ id: 'turn', status: turnStatus, items: [] }]
  const started = []
  const adapter = vm.runInNewContext(code, {
    getCodexQueueDrainDecision,
    isCodexTurnTerminal,
    assertSupportedCodexHistory() {},
    loadCodexTurnCursorWindow: async () => ({ turns: authoritativeTurns, olderCursor: null }),
    rendererChatUpdateTurnLimit: 10,
    bindCodexSubmittedMessageToTurn: async () => {},
    deleteCodexSubmittedMessages: async () => {}
  })
  Object.assign(adapter, {
    threads: new Map([
      ['chat', { id: 'chat', status: { type: status, activeFlags: [] }, turns: authoritativeTurns }]
    ]),
    threadRevisions: new Map(),
    queuedTurnsByThread: new Map([['chat', [{ id: 'queued', text: 'Next message' }]]]),
    queuedTurnStartThreads: new Set(),
    pausedQueuedTurnThreads: new Set(),
    pendingTurnStarts: new Map(),
    pendingTurnIds: new Map(),
    activeTurnIds: new Map(),
    pendingApprovalsByThread: new Map(),
    readThread: async () => ({ thread: { id: 'chat' } }),
    resolveThreadCwd: async () => '/repo',
    resolveThreadName: async () => 'Chat',
    client: { request: async () => {} },
    attachSubmittedUserMessages: async (_chat, turns) => turns,
    filterRolledBackTurns: (_chat, turns) => turns,
    mergeTurn: (_chat, previous, current) => ({ ...previous, ...current }),
    cacheThread: (thread) => adapter.threads.set(thread.id, thread),
    emitChatUpdated() {},
    runQueuedTurn: async (_chat, turn) => started.push(turn.id)
  })
  return { adapter, started }
}

for (const status of ['active', 'notLoaded', 'idle']) {
  test(`terminal transcript drains its queue despite ${status} thread metadata`, async () => {
    const { adapter, started } = fixture(status)
    assert.equal(adapter.getQueueDrainDecision('chat'), 'start')
    await adapter.drainNextQueuedTurn('chat')
    assert.deepEqual(started, ['queued'])
  })
}

test('active turns, errors, approvals and deliberately paused queues wait', () => {
  const { adapter } = fixture('active', 'inProgress')
  assert.equal(adapter.getQueueDrainDecision('chat'), 'wait')
  adapter.threads.get('chat').turns[0].status = 'completed'
  adapter.threads.get('chat').status.type = 'systemError'
  assert.equal(adapter.getQueueDrainDecision('chat'), 'wait')
  adapter.threads.get('chat').status.type = 'idle'
  adapter.pendingApprovalsByThread.set('chat', [{}])
  assert.equal(adapter.getQueueDrainDecision('chat'), 'wait')
  adapter.pendingApprovalsByThread.clear()
  adapter.pausedQueuedTurnThreads.add('chat')
  assert.equal(adapter.getQueueDrainDecision('chat'), 'wait')
})

test('submission locks never allow reconciliation to clear an in-flight message', () => {
  const { adapter } = fixture()
  adapter.pendingTurnIds.set('chat', 'submitting')
  assert.equal(adapter.getQueueDrainDecision('chat', false), 'wait')
  adapter.pendingTurnIds.clear()
  adapter.pendingTurnStarts.set('chat', { pendingTurnId: 'submitting' })
  assert.equal(adapter.getQueueDrainDecision('chat', false), 'wait')
})

test('stale active identity reconciles a terminal transcript then drains automatically', async () => {
  const { adapter, started } = fixture('notLoaded')
  adapter.activeTurnIds.set('chat', 'turn')
  assert.equal(adapter.getQueueDrainDecision('chat'), 'reconcile')
  await adapter.drainNextQueuedTurn('chat')
  assert.equal(adapter.activeTurnIds.has('chat'), false)
  assert.equal(adapter.threads.get('chat').status.type, 'idle')
  assert.deepEqual(started, ['queued'])
})

test('reconciliation waits when history still reports a running turn', async () => {
  const { adapter, started } = fixture('idle', 'inProgress')
  await adapter.drainNextQueuedTurn('chat')
  assert.equal(adapter.threads.get('chat').status.type, 'active')
  assert.equal(adapter.getQueueDrainDecision('chat'), 'wait')
  assert.deepEqual(started, [])
})

test('reconciliation does not overwrite a live successor arriving during enrichment', async () => {
  const { adapter, started } = fixture()
  adapter.activeTurnIds.set('chat', 'turn')
  adapter.attachSubmittedUserMessages = async (_chat, turns) => {
    adapter.threads.set('chat', {
      id: 'chat',
      status: { type: 'active', activeFlags: [] },
      turns: [{ id: 'successor', status: 'inProgress', items: [] }]
    })
    adapter.threadRevisions.set('chat', 1)
    adapter.activeTurnIds.set('chat', 'successor')
    return turns
  }
  await adapter.drainNextQueuedTurn('chat')
  assert.equal(adapter.getActiveTurnId('chat'), 'successor')
  assert.deepEqual(started, [])
})

test('completion before turn/start acknowledgment drains after the submission lock clears', async () => {
  const { adapter } = fixture()
  let acknowledge
  const response = new Promise((resolve) => {
    acknowledge = resolve
  })
  const decisions = []
  adapter.scheduleQueueDrain = (chat) => decisions.push(adapter.getQueueDrainDecision(chat))
  adapter.reconcileStartedTurn = (chat, _pending, turn) => {
    adapter.scheduleQueueDrain(chat)
    return turn
  }
  const sending = adapter.startSubmittedCodexTurn('chat', 'first', () => response)
  assert.equal(adapter.getQueueDrainDecision('chat'), 'wait')
  acknowledge({ turn: { id: 'turn', status: 'completed' } })
  await sending
  assert.deepEqual(decisions, ['wait', 'start'])
  assert.equal(adapter.pendingTurnStarts.has('chat'), false)
})
