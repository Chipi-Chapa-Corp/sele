import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getClaudeQueueDrainDecision } from './ClaudeQueueDrain.ts'
import { getClaudeResultLifecycleDecision } from './ClaudeQueryLifecycle.ts'

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
  'handleQueryEvent'
])
const code = ts.transpileModule(
  `class Harness { ${adapter.members
    .filter((member) => methods.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const context = vm.createContext({
  getClaudeQueueDrainDecision,
  getClaudeResultLifecycleDecision,
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
