import { PendingMessageEdits } from '../PendingMessageEdits.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getClaudeQueueDrainDecision } from './ClaudeQueueDrain.ts'
import {
  getClaudeResultError,
  getClaudeResultLifecycleDecision,
  getClaudeSessionStateLifecycleDecision
} from './ClaudeQueryLifecycle.ts'
import { isClaudeAuthenticationFailure } from './ClaudeAuthentication.ts'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors.ts'
import { getContainerTargetKey } from '../../containerTarget.ts'
import { reconcileProviderRecords } from '../ProviderConversationEngine.ts'
import { markTranscriptRecordsChanged } from '../transcriptProjection/recordChanges.ts'
import {
  applyClaudeStreamEvent,
  retainClaudeStreamTiming,
  clearClaudeStreamMessages
} from './ClaudeStreaming.ts'

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
  'beginPendingMessageEdit',
  'cancelPendingMessageEdit',
  'resumePendingMessages',
  'drainNextQueuedMessage',
  'getQueueDrainDecision',
  'getDrainingMessage',
  'getPendingMessages',
  'handleQueryEvent',
  'addTranscriptMessage',
  'addUserMessage',
  'createUserTranscriptMessage',
  'resumeBackgroundTurn',
  'getOutstandingBackgroundWork',
  'scheduleBackgroundIdleClose',
  'requireAuthentication',
  'sendMessageRespectingQueue',
  'sendQueuedMessageNow',
  'continueChat',
  'editMessage',
  'ensureCompleteState',
  'stopChat',
  'closeStateQuery',
  'deletePendingMessage',
  'editPendingMessage',
  'generateOneShot',
  'sendActiveChatMessage'
])
const code = ts.transpileModule(
  `${source.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === 'AsyncMessageQueue').getText(source)}
  ${source.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(source) === 'toTranscriptMessage')).getText(source)}
  class Harness { pendingMessageEdits = new PendingMessageEdits(); ${adapter.members
    .filter((member) => methods.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const context = vm.createContext({
  PendingMessageEdits,
  isClaudeAuthenticationFailure,
  isExpectedClaudeQueryShutdownError,
  getContainerTargetKey,
  reconcileProviderRecords,
  markTranscriptRecordsChanged,
  applyClaudeStreamEvent,
  retainClaudeStreamTiming,
  clearClaudeStreamMessages,
  getClaudeQueueDrainDecision,
  getClaudeResultError,
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
  contextUsageCloseGraceMs: 0,
  interruptCloseGraceMs: 0,
  query: (...args) => context.queryFactory(...args),
  getPrompt: (message) => message,
  createSdkUserMessage: (session_id, uuid, content) => ({
    type: 'user',
    session_id,
    uuid,
    message: { role: 'user', content }
  }),
  providerOneShotGenerationCanceledMessage: 'Generation canceled'
})
vm.runInContext(code, context)

const setup = () => {
  const instance = new context.Harness()
  instance.authenticationFailures = new Set()
  instance.authenticatedSources = new Set()
  instance.states = new Map()
  instance.reportResultTokenUsage = () => {}
  instance.oneShotGenerations = new Map()
  instance.hiddenSessionIds = new Set()
  instance.takeCanceledOneShotGeneration = () => false
  instance.getQueryRuntime = async () => ({})
  instance.getBaseQueryOptions = () => ({})
  const state = {
    id: 'session',
    container: null,
    query: null,
    input: null,
    queryStartupRevision: 0,
    resultSettling: false,
    partialMessages: new Map(),
    backgroundTaskIds: new Set(),
    waitingForSessionIdle: false,
    stopped: false,
    failed: false,
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
  instance.ensureState = async () => state
  instance.pinState = () => {}
  instance.unpinState = () => {}
  instance.trimIdleStates = () => {}
  instance.rejectPendingRequests = () => {}
  instance.createChatDetail = () => state
  instance.sendQueuedMessageNow = () => {
    state.active = true
    instance.emitUpdate(state)
  }
  return { instance, state, updates, transcript }
}

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const successfulResult = (overrides = {}) => ({
  type: 'result',
  subtype: 'success',
  uuid: 'result',
  session_id: 'session',
  is_error: false,
  terminal_reason: 'completed',
  duration_ms: 1000,
  usage: {
    input_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 1
  },
  ...overrides
})

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

const setupEditing = (messages, supportsResumeDropsTurn) => {
  const { instance, state } = setup()
  Object.assign(state, {
    id: 'session',
    messages,
    messageIds: new Set(messages.map((message) => message.uuid))
  })
  instance.ensureState = async () => state
  instance.pinState = () => {}
  instance.unpinState = () => {}
  instance.trimIdleStates = () => {}
  instance.rejectPendingRequests = () => {}
  instance.closeStateQuery = async () => {
    state.query = null
    state.active = false
  }
  instance.supportsResumeDropsTurn = async () => supportsResumeDropsTurn
  const starts = []
  instance.startStateQuery = async (_state, options, startOptions) => {
    starts.push({ options, ...startOptions })
  }
  instance.sendMessageNow = (_state, text) => {
    const message = { type: 'user', uuid: `edit-${starts.length}`, message: { content: text } }
    state.messages.push(message)
    state.messageIds.add(message.uuid)
    state.active = true
    state.stopped = false
  }
  instance.createChatDetail = () => state
  return { instance, state, starts }
}

for (const supportsResumeDropsTurn of [false, true]) {
  test(`edit, stop, and edit again skips display-only resume points (guard=${supportsResumeDropsTurn})`, async () => {
    const messages = [
      { type: 'user', uuid: 'first' },
      { type: 'assistant', uuid: 'answer' },
      { type: 'system', uuid: 'result:timing', message: { subtype: 'sele_turn_timing' } },
      { type: 'system', uuid: 'background', message: { subtype: 'sele_background_turn' } },
      { type: 'assistant', uuid: 'subagent-answer', parent_tool_use_id: 'tool-agent' },
      { type: 'system', uuid: 'failure', message: { content: 'Disconnected' }, failed: true },
      { type: 'user', uuid: 'original' },
      { type: 'assistant', uuid: 'discarded-answer' }
    ]
    const { instance, state, starts } = setupEditing(messages, supportsResumeDropsTurn)
    const options = { model: 'claude-opus', clientMessageId: 'client-edit' }
    await instance.editMessage('session', 'original', 'first edit', options)
    assert.equal(starts[0].resumeAt, 'answer')
    assert.equal(starts[0].resumeDropsTurn, supportsResumeDropsTurn ? 'original' : undefined)
    assert.equal(starts[0].options, options)
    assert.equal(state.messageIds.has('discarded-answer'), false)
    assert.equal(state.messageIds.has('original'), false)

    state.messages.push({ type: 'assistant', uuid: 'interrupted-answer' })
    state.messageIds.add('interrupted-answer')
    await instance.stopChat('session')
    assert.equal(state.stopped, true)
    await instance.editMessage('session', 'edit-1', 'second edit', options)
    assert.equal(starts[1].resumeAt, 'answer')
    assert.equal(starts[1].resumeDropsTurn, supportsResumeDropsTurn ? 'edit-1' : undefined)
    assert.equal(state.messageIds.has('interrupted-answer'), false)
    assert.equal(state.messageIds.has('edit-1'), false)
    assert.equal(state.messages.at(-1).message.content, 'second edit')
    assert.equal(state.active, true)
    assert.equal(state.stopped, false)
  })
}

test('editing keeps the preceding tool result as the resume point', async () => {
  const { instance, starts } = setupEditing(
    [
      { type: 'assistant', uuid: 'tool-use' },
      { type: 'user', uuid: 'tool-result', message: { content: [{ type: 'tool_result' }] } },
      { type: 'system', uuid: 'result:timing', message: { subtype: 'sele_turn_timing' } },
      { type: 'user', uuid: 'original' }
    ],
    true
  )
  await instance.editMessage('session', 'original', 'edited')
  assert.equal(starts[0].resumeAt, 'tool-result')
})

test('editing the first message rejects before mutating history, even after a system record', async () => {
  const { instance, state, starts } = setupEditing(
    [
      { type: 'system', uuid: 'display-marker', message: { subtype: 'sele_background_turn' } },
      { type: 'user', uuid: 'first' }
    ],
    true
  )
  const before = JSON.stringify(state.messages)
  await assert.rejects(instance.editMessage('session', 'first', 'edited'), /first message/)
  assert.equal(JSON.stringify(state.messages), before)
  assert.equal(starts.length, 0)
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

test('deleting the queued head during startup still sends the next message', async () => {
  const { instance, state } = setup()
  const gate = deferred()
  state.queuedMessages.push({ id: 'second' })
  instance.ensureStateQuery = async () => gate.promise
  const sent = []
  instance.sendQueuedMessageNow = (_state, message) => {
    sent.push(message.id)
    state.active = true
  }
  const drain = instance.drainNextQueuedMessage(state)
  await instance.deletePendingMessage('session', 'first')
  gate.resolve()
  await drain
  assert.deepEqual(sent, ['second'])
  assert.equal(state.queuedMessages.length, 0)
})

test('editing the queued head during option application sends the edited message with its options', async () => {
  const { instance, state } = setup()
  const original = { id: 'first', content: 'old', options: { model: 'old-model' } }
  state.queuedMessages = [original]
  const gate = deferred()
  const prepared = []
  instance.applyTurnOptions = async (_state, options) => {
    prepared.push(options)
    if (prepared.length === 1) await gate.promise
  }
  const editedOptions = { model: 'new-model' }
  instance.createQueuedMessage = (content, options, id) => ({ id, content, options })
  const sent = []
  instance.sendQueuedMessageNow = (_state, message) => {
    sent.push(message)
    state.active = true
  }
  const drain = instance.drainNextQueuedMessage(state)
  await new Promise((resolve) => setImmediate(resolve))
  await instance.editPendingMessage('session', 'first', 'edited', editedOptions)
  gate.resolve()
  await drain
  assert.equal(sent[0].content, 'edited')
  assert.equal(sent[0].options, editedOptions)
  assert.equal(prepared.at(-1), editedOptions)
})

test('API failures with a success subtype publish their error text as a failed turn', async () => {
  const { instance, state, transcript } = setup()
  state.queuedMessages = []
  state.active = true
  const control = { getContextUsage: async () => ({ totalTokens: 10, maxTokens: 100 }) }
  state.query = control
  instance.queueUpdate = () => {}
  instance.refreshSessionMetadata = async () => {}
  assert.equal(
    await instance.handleQueryEvent(
      state,
      control,
      successfulResult({
        is_error: true,
        api_error_status: 529,
        terminal_reason: 'api_error',
        result: 'Overloaded. Try again later.'
      })
    ),
    true
  )
  assert.equal(state.active, false)
  assert.equal(state.failed, true)
  assert.equal(transcript.at(-1).failed, true)
  assert.equal(transcript.at(-1).message.content, 'Overloaded. Try again later.')
})

for (const outcome of ['success', 'api-error', 'error-result', 'disconnect']) {
  test(`one-shot generation handles ${outcome} and closes the query`, async () => {
    const { instance } = setup()
    let closed = 0
    context.queryFactory = () => ({
      close: () => {
        closed += 1
      },
      async *[Symbol.asyncIterator]() {
        if (outcome === 'disconnect') return
        yield successfulResult(
          outcome === 'api-error'
            ? { is_error: true, result: 'Overloaded. Try again later.' }
            : outcome === 'error-result'
              ? { subtype: 'error_max_turns', is_error: true, errors: ['Too many turns.'] }
              : { result: ' Answer ' }
        )
      }
    })
    if (outcome === 'success') assert.equal(await instance.generateOneShot('prompt'), 'Answer')
    else
      await assert.rejects(
        instance.generateOneShot('prompt'),
        outcome === 'api-error'
          ? /Overloaded/
          : outcome === 'error-result'
            ? /Too many turns/
            : /disconnected/i
      )
    assert.equal(closed, 1)
    assert.equal(instance.oneShotGenerations.size, 0)
    assert.equal(instance.hiddenSessionIds.size, 0)
  })
}

test('stop during result settlement cannot leave the next send blocked on a retired query', async () => {
  const { instance, state } = setup()
  const usage = deferred()
  const old = {
    getContextUsage: (options) => {
      assert.equal(options.detail, 'summary')
      return usage.promise
    },
    interrupt: async () => {},
    close() {}
  }
  state.query = old
  state.queuedMessages = []
  state.active = true
  instance.queueUpdate = () => {}
  instance.refreshSessionMetadata = async () => {}
  const handled = instance.handleQueryEvent(state, old, successfulResult())
  assert.equal(state.resultSettling, true)
  await instance.stopChat('session')
  const replacement = { getContextUsage: async () => ({ totalTokens: 10, maxTokens: 100 }) }
  instance.ensureStateQuery = async () => {
    state.query = replacement
  }
  instance.createQueuedMessage = (content) => ({ id: content })
  const sent = []
  instance.sendQueuedMessageNow = (_state, message) => {
    sent.push(message.id)
    state.active = true
  }
  await instance.sendMessageRespectingQueue(state, 'next')
  assert.deepEqual(sent, ['next'])

  // The old handler must not clear a newer query's own settlement lock either.
  state.resultSettling = true
  usage.resolve({ totalTokens: 10, maxTokens: 100 })
  await handled
  assert.equal(state.resultSettling, true)
  assert.equal(state.query, replacement)
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

test('Claude steering and original echoes reconcile by their own UUIDs without losing attachments', async () => {
  const instance = new context.Harness()
  instance.transcriptProjections = new WeakMap()
  instance.reportLiveTokenUsage = () => false
  instance.queueUpdate = () => {}
  const state = { id: 'session', messages: [], messageIds: new Set() }
  const original = {
    id: 'original',
    content: 'original prompt',
    createdAt: 1,
    attachments: [{ kind: 'image', path: '/original.png' }]
  }
  const steering = {
    id: 'steer',
    content: 'change direction',
    createdAt: 2,
    attachments: [{ kind: 'image', path: '/steer.png' }]
  }
  instance.addUserMessage(state, original)
  instance.addUserMessage(state, steering, 'Steering with', 'steering')
  for (const message of [steering, steering, original]) {
    assert.equal(
      await instance.handleQueryEvent(
        state,
        {},
        {
          type: 'user',
          uuid: message.id,
          session_id: state.id,
          message: { role: 'user', content: message.content },
          parent_tool_use_id: null
        }
      ),
      false
    )
  }
  assert.deepEqual(
    Array.from(state.messages, (message) => message.uuid),
    ['original', 'steer']
  )
  assert.equal(state.messages[0].message.content, original.content)
  assert.equal(state.messages[0].attachments, original.attachments)
  assert.equal(state.messages[1].message.content, steering.content)
  assert.equal(state.messages[1].attachments, steering.attachments)
  assert.equal(state.messages[1].kind, 'steering')
  assert.equal(state.messages[1].label, 'Steering with')
})

test('background assistant output reopens the finished turn until Claude replies', async () => {
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
  assert.equal(state.active, false)
  await instance.handleQueryEvent(state, control, {
    type: 'stream_event',
    session_id: 'session',
    parent_tool_use_id: null,
    event: { type: 'message_start', message: { id: 'follow-up', role: 'assistant', content: [] } }
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

for (const sessionState of ['running', 'requires_action']) {
  test(`late ${sessionState} notifications cannot leave a finished chat active`, async () => {
    const instance = new context.Harness()
    const control = { getContextUsage: async () => ({ totalTokens: 10, maxTokens: 100 }) }
    const state = {
      id: 'session',
      query: control,
      active: true,
      stopped: false,
      failed: false,
      partialMessages: new Map(),
      backgroundTaskIds: new Set(['agent']),
      taskNotificationPending: false,
      waitingForSessionIdle: false,
      queuedMessages: [],
      pendingApprovals: [],
      pendingUserInputs: []
    }
    const updates = []
    const closed = []
    instance.addTranscriptMessage = () => {}
    instance.reportResultTokenUsage = () => {}
    instance.refreshSessionMetadata = async () => {}
    instance.queueUpdate = () => {}
    instance.emitUpdate = () => updates.push(state.active)
    instance.closeStateQuery = async () => closed.push(state.id)

    await instance.handleQueryEvent(state, control, {
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
    })
    await instance.handleQueryEvent(state, control, {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: []
    })
    await instance.handleQueryEvent(state, control, {
      type: 'system',
      subtype: 'session_state_changed',
      state: sessionState
    })
    assert.equal(state.active, false, 'session notifications must preserve completion')
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual(closed, [], 'a follow-up preparing its response must keep the query alive')
    await instance.handleQueryEvent(state, control, {
      type: 'system',
      subtype: 'session_state_changed',
      state: 'idle'
    })

    assert.equal(state.active, false, 'only new assistant output should reopen the turn')
    assert.deepEqual(updates, [false], 'the sidebar must retain the completed status')
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.deepEqual(closed, ['session'], 'the background idle cleanup must still run')
  })
}

test('a message sent while a finished turn settles is sent instead of racing the close', async () => {
  const { instance, state } = setup()
  let releaseUsage
  const control = {
    getContextUsage: () =>
      new Promise((resolve) => {
        releaseUsage = () => resolve({ totalTokens: 10, maxTokens: 100 })
      })
  }
  Object.assign(state, {
    id: 'session',
    container: null,
    query: control,
    active: true,
    stopped: false,
    failed: false,
    resultSettling: false,
    partialMessages: new Map(),
    backgroundTaskIds: new Set(),
    taskNotificationPending: false,
    waitingForSessionIdle: false,
    queuedMessages: []
  })
  instance.queueUpdate = () => {}
  instance.refreshSessionMetadata = async () => {}
  instance.createQueuedMessage = (content) => ({ id: content })
  const prepared = []
  instance.applyTurnOptions = async () => prepared.push(state.query)
  const sent = []
  instance.sendQueuedMessageNow = (_state, message) => {
    sent.push(message.id)
    state.active = true
  }

  const handled = instance.handleQueryEvent(state, control, {
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
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.active, false)
  assert.equal(state.resultSettling, true)

  // The queued message arrives before the result handler decides whether to close the query.
  await instance.sendMessageRespectingQueue(state, 'follow-up')
  assert.deepEqual(prepared, [], 'no control request may start on a query about to close')
  assert.deepEqual(sent, [])

  releaseUsage()
  assert.equal(await handled, false, 'the query must stay open for the follow-up')
  assert.equal(state.resultSettling, false)
  assert.deepEqual(prepared, [control])
  assert.deepEqual(sent, ['follow-up'])
  assert.deepEqual(state.queuedMessages, [])
})

test('a rejected idle send does not remain queued while its text stays in the composer draft', async () => {
  const { instance, state } = setup()
  state.queuedMessages = []
  instance.createQueuedMessage = (content) => ({ id: content, content })
  instance.ensureStateQuery = async () => {
    throw new Error('No conversation found')
  }
  await assert.rejects(instance.sendMessageRespectingQueue(state, 'test'), /No conversation found/)
  assert.equal(state.queuedMessages.length, 0)
  assert.equal(state.queuedMessagesPaused, false)
})

test('startup failure preserves earlier explicit queued messages', async () => {
  const { instance, state } = setup()
  const original = state.queuedMessages[0]
  instance.createQueuedMessage = (content) => ({ id: content, content })
  instance.ensureStateQuery = async () => {
    throw new Error('No conversation found')
  }
  await assert.rejects(instance.sendMessageRespectingQueue(state, 'next'), /No conversation found/)
  assert.equal(state.queuedMessages[0], original)
  assert.equal(state.queuedMessages.length, 2)
  assert.equal(state.queuedMessagesPaused, true)
})

test('editing Claude queue during startup holds dispatch through option application and cancel resumes once', async () => {
  const { instance, state } = setup()
  const startup = deferred()
  instance.applyTurnOptions = () => startup.promise
  const draining = instance.drainNextQueuedMessage(state)
  await instance.beginPendingMessageEdit('session', 'first', 'edit')
  startup.resolve()
  await draining
  assert.equal(state.active, false)
  assert.equal(state.queuedMessages[0].id, 'first')
  assert.equal(instance.getDrainingMessage(state), null)
  await instance.cancelPendingMessageEdit('session', 'first', 'stale')
  assert.equal(state.active, false)
  await instance.cancelPendingMessageEdit('session', 'first', 'edit')
  assert.equal(state.active, true)
  assert.equal(state.queuedMessages.length, 0)
})

test('editing a later Claude queued message still sends the messages queued before it', async () => {
  const { instance, state } = setup()
  state.queuedMessages = [{ id: 'first' }, { id: 'edited' }, { id: 'third' }]
  const sent = []
  instance.sendQueuedMessageNow = (_state, message) => {
    sent.push(message.id)
    state.active = true
  }
  await instance.beginPendingMessageEdit('session', 'edited', 'edit')
  assert.equal(await instance.drainNextQueuedMessage(state), true)
  assert.deepEqual(sent, ['first'])
  state.active = false
  assert.equal(instance.getQueueDrainDecision(state), 'wait')
  assert.equal(await instance.drainNextQueuedMessage(state), false)
  await instance.cancelPendingMessageEdit('session', 'edited', 'edit')
  assert.deepEqual(sent, ['first', 'edited'])
  assert.deepEqual(
    state.queuedMessages.map((message) => message.id),
    ['third']
  )
})

test('new Claude submissions cannot clear an edit hold', async () => {
  const { instance, state } = setup()
  instance.createQueuedMessage = (content, options, id = 'new') => ({ id, content, options })
  await instance.beginPendingMessageEdit('session', 'first', 'edit')
  await instance.sendActiveChatMessage('session', 'later', 'steer')
  assert.equal(state.queuedMessages.length, 2)
  assert.equal(state.queuedMessages[1].kind, 'steering')
  assert.equal(state.active, false)
  assert.equal(instance.getQueueDrainDecision(state), 'wait')
})

test('failed Claude startup while saving restores the original queued payload and the edit hold', async () => {
  const { instance, state } = setup()
  const original = state.queuedMessages[0]
  original.content = 'original'
  instance.createQueuedMessage = (content, options, id) => ({ content, options, id })
  await instance.beginPendingMessageEdit('session', 'first', 'edit')
  instance.ensureStateQuery = async () => {
    throw new Error('offline')
  }
  await assert.rejects(
    instance.editPendingMessage('session', 'first', 'revised', {}, 'edit'),
    /offline/
  )
  assert.equal(state.queuedMessages[0], original)
  assert.equal(state.queuedMessagesPaused, false)
  assert.equal(instance.pendingMessageEdits.has('session'), true)
})
