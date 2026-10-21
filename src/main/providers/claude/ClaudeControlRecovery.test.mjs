import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getClaudeQueueDrainDecision } from './ClaudeQueueDrain.ts'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors.ts'
import { PendingMessageEdits } from '../PendingMessageEdits.ts'

// Run the real lifecycle methods with an unresponsive SDK, without launching Claude or Electron.
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
  'interruptWithMessage',
  'applyTurnOptions',
  'stopChat',
  'closeStateQuery',
  'drainNextQueuedMessage',
  'getQueueDrainDecision',
  'onChatUpdated'
])
const helpers = source.statements.filter(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((declaration) =>
      ['settleWithin', 'awaitClaudeTurnOptions'].includes(declaration.name.getText(source))
    )
)
const context = vm.createContext({
  setTimeout,
  clearTimeout,
  console,
  Error,
  interruptCloseGraceMs: 10,
  turnOptionsTimeoutMs: 10,
  isExpectedClaudeQueryShutdownError,
  getClaudeQueueDrainDecision,
  getClaudeModel: (options) => options.model,
  getClaudePermissionMode: () => 'default',
  toEffortLevel: () => undefined,
  getSandbox: () => ({})
})
vm.runInContext(
  ts.transpileModule(
    `
  ${helpers.map((node) => node.getText(source)).join('\n')}
  class Harness {
    ${adapter.members
      .filter((member) => methods.has(member.name?.getText(source)))
      .map((member) => member.getText(source))
      .join('\n')}
  }
  globalThis.Harness = Harness
`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText,
  context
)

const setup = (interrupt) => {
  const instance = new context.Harness()
  const closed = []
  const sent = []
  const control = {
    interrupt,
    close: () => closed.push(control),
    setPermissionMode: async () => {},
    applyFlagSettings: async () => {}
  }
  const state = {
    id: 'session',
    query: control,
    queryStartupRevision: 0,
    active: true,
    stopped: false,
    failed: false,
    resultSettling: false,
    queryReadOnly: false,
    queryModel: undefined,
    queuedMessages: [],
    queuedMessagesPaused: false,
    queueDrainInProgress: false,
    pendingApprovals: [],
    pendingUserInputs: [],
    backgroundTaskIds: new Set(),
    partialMessages: new Map()
  }
  const replacement = { ...control, close: () => closed.push(replacement) }
  instance.chatUpdatedListeners = new Set()
  instance.pendingMessageEdits = new PendingMessageEdits()
  instance.emitUpdate = () => {
    for (const listener of instance.chatUpdatedListeners) listener({ id: state.id })
  }
  instance.ensureStateQuery = async () => {
    if (!state.query) {
      state.query = replacement
      state.queryReadOnly = false
      state.queryModel = undefined
    }
  }
  instance.ensureState = async () => state
  instance.rejectPendingRequests = () => {}
  instance.pinState = () => {}
  instance.unpinState = () => {}
  instance.trimIdleStates = () => {}
  instance.createChatDetail = () => state
  instance.sendQueuedMessageNow = (_state, message) => {
    state.active = true
    state.stopped = false
    sent.push(message)
    instance.emitUpdate()
  }
  return { instance, state, control, replacement, closed, sent }
}

for (const acknowledge of [false, true]) {
  test(`interrupt recovers when ${acknowledge ? 'acknowledged without a result' : 'never acknowledged'}`, async () => {
    const { instance, state, closed, sent, control, replacement } = setup(() =>
      acknowledge ? Promise.resolve() : new Promise(() => {})
    )
    const message = { id: 'next', content: 'continue' }
    await instance.interruptWithMessage(state, message)
    assert.deepEqual(closed, [control])
    assert.equal(state.query, replacement)
    assert.deepEqual(sent, [message])
    assert.equal(state.queuedMessages.length, 0)
    assert.equal(state.queueDrainInProgress, false)
    assert.equal(instance.chatUpdatedListeners.size, 0)
  })
}

test('a prompt dispatched by the interrupted result is not sent twice', async () => {
  const { instance, state, closed, sent } = setup(async () => {
    state.active = false
    await instance.drainNextQueuedMessage(state)
  })
  const message = { id: 'next' }
  await instance.interruptWithMessage(state, message)
  assert.deepEqual(sent, [message])
  assert.deepEqual(closed, [])
})

test('Stop wins over a pending interrupt and late acknowledgement cannot restart it', async () => {
  let acknowledge
  const receipt = new Promise((resolve) => {
    acknowledge = resolve
  })
  const { instance, state, sent, closed, control } = setup(() => receipt)
  const message = { id: 'next' }
  const interrupting = instance.interruptWithMessage(state, message)
  await instance.stopChat(state.id)
  await interrupting
  acknowledge()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(closed, [control])
  assert.deepEqual(sent, [])
  assert.equal(state.query, null)
  assert.equal(state.stopped, true)
  assert.equal(state.queuedMessagesPaused, true)
  assert.deepEqual(state.queuedMessages, [message])
})

test('failed recovery preserves the interrupted message for retry', async () => {
  const { instance, state, sent } = setup(() => new Promise(() => {}))
  instance.ensureStateQuery = async () => {
    throw new Error('startup failed')
  }
  const message = { id: 'next' }
  await assert.rejects(instance.interruptWithMessage(state, message), /startup failed/)
  assert.deepEqual(sent, [])
  assert.deepEqual(state.queuedMessages, [message])
  assert.equal(state.queueDrainInProgress, false)
  assert.equal(state.queuedMessagesPaused, true)
})

test('hung settings release the send lock, close the query, and allow a fresh retry', async () => {
  const { instance, state, control, closed, sent } = setup(async () => {})
  control.applyFlagSettings = () => new Promise(() => {})
  state.active = false
  const message = { id: 'next', options: {} }
  state.queuedMessages.push(message)
  await assert.rejects(
    instance.drainNextQueuedMessage(state),
    /did not apply chat settings in time/
  )
  assert.deepEqual(closed, [control])
  assert.equal(state.query, null)
  assert.equal(state.queueDrainInProgress, false)
  assert.equal(state.queuedMessagesPaused, true)
  assert.deepEqual(state.queuedMessages, [message])
  state.queuedMessagesPaused = false
  await instance.drainNextQueuedMessage(state)
  assert.deepEqual(sent, [message])
})

test('a timed out settings request cannot close a newer query', async () => {
  const { instance, state, control, replacement, closed } = setup(async () => {})
  control.applyFlagSettings = () => new Promise(() => {})
  const applying = instance.applyTurnOptions(state, {})
  state.query = replacement
  await assert.rejects(applying, /did not apply chat settings in time/)
  assert.equal(state.query, replacement)
  assert.deepEqual(closed, [])
})
