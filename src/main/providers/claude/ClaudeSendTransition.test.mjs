import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getClaudeQueueDrainDecision } from './ClaudeQueueDrain.ts'
import {
  getClaudeResultLifecycleDecision,
  getClaudeSessionStateLifecycleDecision
} from './ClaudeQueryLifecycle.ts'
import { isClaudeAuthenticationFailure } from './ClaudeAuthentication.ts'
import { getContainerTargetKey } from '../../containerTarget.ts'
import { retainClaudeStreamTiming, clearClaudeStreamMessages } from './ClaudeStreaming.ts'

// Exercise the actual adapter methods without starting Electron or the Claude CLI.
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
  'drainNextQueuedMessage',
  'getQueueDrainDecision',
  'getDrainingMessage',
  'getPendingMessages',
  'handleQueryEvent',
  'resumeBackgroundTurn',
  'getOutstandingBackgroundWork',
  'scheduleBackgroundIdleClose',
  'requireAuthentication',
  'sendMessageRespectingQueue',
  'sendQueuedMessageNow',
  'continueChat',
  'editMessage',
  'sendActiveChatMessage'
])
const code = ts.transpileModule(
  `${source.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(source) === 'toTranscriptMessage')).getText(source)}
  class Harness { ${adapter.members
    .filter((member) => methods.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const context = vm.createContext({
  isClaudeAuthenticationFailure,
  getContainerTargetKey,
  retainClaudeStreamTiming,
  clearClaudeStreamMessages,
  getClaudeQueueDrainDecision,
  getClaudeResultLifecycleDecision,
  getClaudeSessionStateLifecycleDecision,
  backgroundIdleCloseGraceMs: 0,
  setTimeout,
  randomUUID: () => 'marker',
  claudeBackgroundTurnSubtype: 'sele_background_turn',
  getTokenBreakdown: (inputTokens, outputTokens, cachedInputTokens) => ({
    inputTokens,
    outputTokens,
    cachedInputTokens
  }),
  settleWithin: (promise) => promise,
  contextUsageCloseGraceMs: 0
})
vm.runInContext(code, context)

const setup = () => {
  const instance = new context.Harness()
  instance.authenticationFailures = new Set()
  instance.authenticatedSources = new Set()
  instance.states = new Map()
  instance.reportResultTokenUsage = () => {}
  const state = {
    queuedMessages: [{ id: 'first' }],
    queuedMessagesPaused: false,
    queueDrainInProgress: false,
    active: false,
    pendingApprovals: [],
    pendingUserInputs: [],
    contextUsage: { usedTokens: 42000, maxTokens: 200000 }
  }
  const updates = []
  const transcript = []
  instance.addTranscriptMessage = (_state, message) => transcript.push(message)
  instance.emitUpdate = () => {
    const draining = instance.getDrainingMessage(state)
    updates.push({
      sent: draining?.id ?? null,
      pending: Array.from(instance.getPendingMessages(state, draining?.id ?? null), (m) => m.id),
      usage: state.contextUsage,
      draining: state.queueDrainInProgress
    })
  }
  instance.ensureStateQuery = async () => {}
  instance.applyTurnOptions = async () => {}
  instance.sendQueuedMessageNow = () => {
    state.active = true
    instance.emitUpdate(state)
  }
  return { instance, state, updates }
}

test('live expired OAuth errors finish the turn and pause queued messages for recovery', async () => {
  const { instance, state } = setup()
  state.partialMessages = new Map()
  state.active = true
  state.failed = false
  const pending = state.queuedMessages[0]
  const sibling = { container: null, queuedMessagesPaused: false }
  const remote = {
    container: { kind: 'container', tool: 'ssh', name: 'server' },
    queuedMessagesPaused: false
  }
  instance.states.set('sibling', sibling)
  instance.states.set('remote', remote)
  const updates = []
  const messages = []
  instance.reportLiveTokenUsage = () => {}
  instance.addTranscriptMessage = (_state, message) => messages.push(message)
  instance.emitUpdate = (_state, completed) => updates.push(completed)
  const accountUpdates = []
  instance.queueUpdate = (other) => accountUpdates.push(other)
  const text = 'Failed to authenticate: OAuth session expired and could not be refreshed'
  assert.equal(
    await instance.handleQueryEvent(
      state,
      {},
      {
        type: 'assistant',
        uuid: 'auth',
        session_id: 'session',
        parent_tool_use_id: null,
        error: 'authentication_failed',
        message: { content: [{ type: 'text', text }] }
      }
    ),
    true,
    'the consumer must close the unauthenticated query'
  )
  assert.equal(state.active, false)
  assert.equal(state.failed, true)
  assert.equal(state.queuedMessagesPaused, true)
  assert.equal(state.queuedMessages[0], pending)
  assert.equal(instance.getQueueDrainDecision(state), 'wait')
  assert.equal(messages[0].error, 'authentication_failed')
  assert.deepEqual(updates, [true])
  assert.equal(instance.authenticationFailures.has('host'), true)
  assert.deepEqual(
    accountUpdates,
    [sibling],
    'other chats using the failed account must also disable sending'
  )
  assert.equal(sibling.queuedMessagesPaused, true)
  assert.equal(remote.queuedMessagesPaused, false)
})

test('unauthenticated sends and retries are rejected before changing transcript or queue', async () => {
  const { instance, state } = setup()
  instance.authenticationFailures.add('host')
  instance.ensureState = async () => state
  const before = JSON.stringify(state)
  for (const action of [
    () => instance.continueChat('session', 'another message'),
    () => instance.sendActiveChatMessage('session', 'another message', 'queue'),
    () => instance.sendMessageRespectingQueue(state, 'another message'),
    () => instance.editMessage('session', 'first', 'retry')
  ])
    await assert.rejects(action(), /Sign in again before sending/)
  assert.equal(JSON.stringify(state), before)
})

test('startup presents the submitted message as sent and preserves usage', async () => {
  const { instance, state, updates } = setup()
  const usage = state.contextUsage
  await instance.drainNextQueuedMessage(state)
  assert.equal(updates[0].sent, 'first')
  assert.deepEqual(updates[0].pending, [])
  assert.ok(updates.every((update) => update.usage === usage))
})

test('messages added during startup remain queued after the first message starts', async () => {
  const { instance, state, updates } = setup()
  instance.ensureStateQuery = async () => {
    state.queuedMessages.push({ id: 'second' })
  }
  await instance.drainNextQueuedMessage(state)
  assert.equal(updates[1].sent, null)
  assert.deepEqual(updates[1].pending, ['second'])
})

test('startup failure publishes the paused queued message for recovery', async () => {
  const { instance, state, updates } = setup()
  instance.ensureStateQuery = async () => {
    throw new Error('Startup failed')
  }
  await assert.rejects(instance.drainNextQueuedMessage(state), /Startup failed/)
  assert.equal(updates.at(-1).sent, null)
  assert.deepEqual(updates.at(-1).pending, ['first'])
  assert.equal(updates.at(-1).draining, false)
})

test('a preceding result keeps SDK-queued steering alive until its own result', async () => {
  const instance = new context.Harness()
  instance.reportResultTokenUsage = () => {}
  const control = { getContextUsage: async () => ({ totalTokens: 10, maxTokens: 100 }) }
  const state = {
    id: 'session',
    query: control,
    active: true,
    stopped: false,
    failed: false,
    partialMessages: new Map(),
    backgroundTaskIds: new Set(),
    queuedMessages: [],
    queuedMessagesPaused: false,
    queueDrainInProgress: false,
    pendingApprovals: [],
    pendingUserInputs: []
  }
  const updates = []
  const transcript = []
  instance.addTranscriptMessage = (_state, message) => transcript.push(message)
  instance.emitUpdate = (state, completed = false) =>
    updates.push({ active: state.active, completed })
  instance.queueUpdate = () => {}
  instance.refreshSessionMetadata = async () => {}
  const result = {
    type: 'result',
    subtype: 'success',
    terminal_reason: 'completed',
    duration_ms: 12500,
    usage: {
      input_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1
    }
  }
  assert.equal(
    await instance.handleQueryEvent(state, control, { ...result, queued_turn_count: 1 }),
    false
  )
  assert.equal(state.active, true)
  assert.equal(state.waitingForSessionIdle, false)
  assert.equal(transcript[0].message.duration_ms, 12500)
  assert.ok(Number.isFinite(Date.parse(transcript[0].timestamp)))
  assert.deepEqual(updates, [{ active: true, completed: false }])
  assert.equal(
    await instance.handleQueryEvent(state, control, { ...result, queued_turn_count: 0 }),
    true
  )
  assert.equal(state.active, false)
  assert.deepEqual(updates.at(-1), { active: false, completed: true })
})

test('background agent notifications reopen the finished turn until Claude replies', async () => {
  const instance = new context.Harness()
  instance.reportResultTokenUsage = () => {}
  instance.reportLiveTokenUsage = () => false
  const closed = []
  instance.closeStateQuery = async (state) => {
    closed.push(state.id)
    state.query = null
  }
  const control = { getContextUsage: async () => ({ totalTokens: 10, maxTokens: 100 }) }
  const state = {
    id: 'session',
    query: control,
    active: true,
    stopped: false,
    failed: false,
    partialMessages: new Map(),
    backgroundTaskIds: new Set(),
    taskNotificationPending: false,
    waitingForSessionIdle: false,
    queuedMessages: [],
    queuedMessagesPaused: false,
    queueDrainInProgress: false,
    pendingApprovals: [],
    pendingUserInputs: []
  }
  const updates = []
  instance.addTranscriptMessage = () => {}
  instance.emitUpdate = (state, completed = false) =>
    updates.push({ active: state.active, completed })
  instance.queueUpdate = () => {}
  instance.refreshSessionMetadata = async () => {}
  const result = {
    type: 'result',
    subtype: 'success',
    terminal_reason: 'completed',
    duration_ms: 1000,
    usage: {
      input_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1
    }
  }
  const tasks = (...ids) => ({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: ids.map((task_id) => ({ task_id, task_type: 'local_agent', description: task_id }))
  })
  const assistant = (parent_tool_use_id) => ({
    type: 'assistant',
    uuid: `assistant-${updates.length}`,
    session_id: 'session',
    parent_tool_use_id,
    message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
  })

  await instance.handleQueryEvent(state, control, tasks('a', 'b'))
  assert.equal(await instance.handleQueryEvent(state, control, result), false)
  assert.equal(state.active, false)
  assert.equal(state.waitingForSessionIdle, true)

  // Subagent output is not the main thread resuming.
  await instance.handleQueryEvent(state, control, assistant('toolu_agent'))
  assert.equal(state.active, false)

  // Agent "a" finishes; Claude starts a turn by itself to read its result.
  await instance.handleQueryEvent(state, control, tasks('b'))
  await instance.handleQueryEvent(state, control, {
    type: 'system',
    subtype: 'session_state_changed',
    state: 'running'
  })
  assert.equal(state.active, true)
  assert.deepEqual(updates.at(-1), { active: true, completed: false })
  assert.equal(await instance.handleQueryEvent(state, control, result), false)
  assert.equal(state.active, false)

  // The last agent finishing must not close the query before its follow-up turn runs.
  assert.equal(await instance.handleQueryEvent(state, control, tasks()), false)
  assert.equal(
    await instance.handleQueryEvent(state, control, {
      type: 'system',
      subtype: 'session_state_changed',
      state: 'idle'
    }),
    false
  )
  await instance.handleQueryEvent(state, control, assistant(null))
  assert.equal(state.active, true)
  assert.equal(await instance.handleQueryEvent(state, control, result), true)
  assert.equal(state.active, false)
  assert.deepEqual(updates.at(-1), { active: false, completed: true })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(closed, [])
})

test('a finished background task without a follow-up turn closes after the grace period', async () => {
  const instance = new context.Harness()
  instance.queueUpdate = () => {}
  const closed = []
  instance.closeStateQuery = async (state) => closed.push(state.id)
  const control = {}
  const state = {
    id: 'session',
    query: control,
    active: false,
    backgroundTaskIds: new Set(['a']),
    taskNotificationPending: false,
    waitingForSessionIdle: true
  }
  assert.equal(
    await instance.handleQueryEvent(state, control, {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: []
    }),
    false
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(closed, ['session'])
})
