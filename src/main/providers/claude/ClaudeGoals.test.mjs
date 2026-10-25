import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getClaudeGoalCommand, mapClaudeActiveGoal, readClaudeHistoryGoal } from './ClaudeGoals.ts'

test('goal commands preserve conditions and validate Claude limits and reserved aliases', () => {
  assert.equal(
    getClaudeGoalCommand('  Tests pass\nand lint is clean  '),
    '/goal Tests pass\nand lint is clean'
  )
  for (const empty of [null, '', '  ']) assert.equal(getClaudeGoalCommand(empty), '/goal clear')
  assert.equal(getClaudeGoalCommand('x'.repeat(4000)).length, 4006)
  assert.throws(() => getClaudeGoalCommand('x'.repeat(4001)), /4,000/)
  for (const alias of ['clear', 'STOP', 'off', 'reset', 'none', 'cancel'])
    assert.throws(() => getClaudeGoalCommand(alias), /reserved/)
})

const nativeGoal = (condition = 'Tests pass') => ({
  condition,
  iterations: 2,
  set_at: 1000,
  tokens_at_start: 500,
  last_reason: 'Keep working'
})
test('maps active/cleared events without treating the token baseline as spend', () => {
  const goal = mapClaudeActiveGoal('session', nativeGoal(), 3000)
  assert.equal(goal.objective, 'Tests pass')
  assert.equal(goal.status, 'active')
  assert.equal(goal.threadId, 'session')
  assert.equal(goal.createdAt, 1000)
  assert.equal(goal.timeUsedSeconds, 2)
  assert.equal(goal.tokensUsed, 0)
  assert.equal(goal.tokenBudget, null)
  assert.equal(mapClaudeActiveGoal('session', null), null)
})

const attachment = (condition, extra = {}) => ({
  type: 'attachment',
  timestamp: '2026-10-25T00:00:00Z',
  attachment: { type: 'goal_status', condition, met: false, ...extra }
})
test('native history uses the latest main-session goal, including clears and impossible verdicts', () => {
  const entries = [attachment('first'), attachment('second')]
  assert.equal(readClaudeHistoryGoal('session', entries).objective, 'second')
  assert.equal(
    readClaudeHistoryGoal('session', [
      ...entries,
      attachment('second', { met: true, sentinel: true })
    ]),
    null
  )
  assert.equal(
    readClaudeHistoryGoal('session', [...entries, attachment('second', { failed: true })]),
    null
  )
  assert.equal(
    readClaudeHistoryGoal('session', [...entries, { ...attachment('child'), isSidechain: true }])
      .objective,
    'second'
  )
  assert.equal(
    readClaudeHistoryGoal('session', [{ type: 'user', message: { content: '/goal fake' } }]),
    undefined
  )
})

// Exercise the real adapter dispatch/event methods without launching Claude or Electron.
const source = ts.createSourceFile(
  'ClaudeProviderAdapter.ts',
  readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const adapter = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'ClaudeProviderAdapter'
)
const methods = new Set(['setChatGoal', 'handleQueryEvent', 'sendQueuedMessageNow'])
const context = vm.createContext({
  getClaudeGoalCommand,
  mapClaudeActiveGoal,
  Error,
  console,
  setTimeout: (fn) => setTimeout(fn, 100),
  clearTimeout,
  createSdkUserMessage: (session_id, uuid, content) => ({ session_id, uuid, message: { content } })
})
vm.runInContext(
  ts.transpileModule(
    `class Harness { ${adapter.members
      .filter((member) => methods.has(member.name?.getText(source)))
      .map((member) => member.getText(source))
      .join('\n')} }; globalThis.Harness = Harness`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText,
  context
)

const setup = ({ active = false, commands = ['goal'], reply = true } = {}) => {
  const instance = new context.Harness()
  const sent = [],
    updates = [],
    transcript = [],
    interrupts = []
  let pins = 0
  const control = { supportedCommands: async () => commands.map((name) => ({ name })) }
  const state = {
    id: 'session',
    goal: null,
    active,
    stopped: false,
    failed: false,
    query: control,
    queuedMessages: [],
    queuedMessagesPaused: false,
    options: {
      model: 'claude',
      sandboxMode: 'read-only',
      skills: [{ name: 'old-skill' }],
      files: [{ path: '/old-file' }],
      images: [{ path: '/old-image' }]
    },
    input: {
      push: (message) => {
        sent.push(message)
        if (reply)
          queueMicrotask(() =>
            instance.handleQueryEvent(state, control, {
              type: 'active_goal',
              session_id: state.id,
              value:
                message.message.content === '/goal clear'
                  ? null
                  : nativeGoal(message.message.content.slice(6))
            })
          )
      }
    }
  }
  instance.ensureState = async () => state
  instance.requireAuthentication = () => {}
  instance.pinState = () => {
    pins++
  }
  instance.unpinState = () => {
    pins--
  }
  instance.trimIdleStates = () => {}
  instance.ensureStateQuery = async () => {}
  instance.createQueuedMessage = (content, options) => ({
    id: 'command',
    content,
    prompt: content,
    options
  })
  instance.drainNextQueuedMessage = async () => {
    instance.sendQueuedMessageNow(state, state.queuedMessages.shift())
  }
  instance.interruptWithMessage = async (_state, message) => {
    interrupts.push(message.content)
    // A resumed query can announce the previous goal before processing the new command.
    await instance.handleQueryEvent(state, control, {
      type: 'active_goal',
      value: nativeGoal('Old goal')
    })
    instance.sendQueuedMessageNow(state, message)
  }
  instance.addUserMessage = () => {}
  instance.emitUpdate = () => updates.push(state.goal)
  instance.queueUpdate = () => {}
  instance.addTranscriptMessage = (_state, message) => transcript.push(message)
  return {
    instance,
    state,
    control,
    sent,
    updates,
    transcript,
    interrupts,
    get pins() {
      return pins
    }
  }
}

for (const active of [false, true]) {
  test(`set/edit/clear uses native commands and acknowledged state (${active ? 'running' : 'idle'})`, async () => {
    const f = setup({ active })
    const goal = await f.instance.setChatGoal('session', 'Tests pass')
    assert.equal(goal.objective, 'Tests pass')
    assert.equal(f.sent[0].message.content, '/goal Tests pass')
    assert.equal(f.state.options.model, 'claude')
    assert.equal(f.state.options.sandboxMode, 'read-only')
    assert.equal(f.state.options.skills, undefined)
    assert.equal(f.state.options.files, undefined)
    assert.equal(f.state.options.images, undefined)
    assert.equal((await f.instance.setChatGoal('session', 'Lint passes')).objective, 'Lint passes')
    assert.equal(await f.instance.setChatGoal('session', null), null)
    assert.equal(f.sent.at(-1).message.content, '/goal clear')
    assert.equal(f.state.goal, null)
    assert.equal(f.pins, 0)
    assert.equal(f.state.goalRequest, undefined)
    assert.equal(f.interrupts.length, active ? 3 : 2)
  })
}

test('unsupported CLIs reject before sending and release the mutation lock', async () => {
  const f = setup({ commands: [] })
  await assert.rejects(f.instance.setChatGoal('session', 'Tests pass'), /does not expose/)
  assert.equal(f.sent.length, 0)
  assert.equal(f.pins, 0)
  assert.equal(f.state.goalMutation, false)
})

test('native policy rejection reaches the goal dialog and preserves the previous goal', async () => {
  const f = setup({ reply: false })
  f.state.goal = mapClaudeActiveGoal('session', nativeGoal('Previous goal'))
  const result = f.instance.setChatGoal('session', 'Tests pass')
  await new Promise(setImmediate)
  await f.instance.handleQueryEvent(f.state, f.control, {
    type: 'system',
    subtype: 'local_command_output',
    content: '/goal cannot run while hooks are restricted',
    uuid: 'output'
  })
  await assert.rejects(result, /hooks are restricted/)
  assert.equal(f.state.goal.objective, 'Previous goal')
  assert.equal(f.transcript.length, 1)
})

test('clear without an active goal accepts the native command output and preserves a paused queue', async () => {
  const f = setup({ reply: false })
  f.state.queuedMessagesPaused = true
  const result = f.instance.setChatGoal('session', null)
  await new Promise(setImmediate)
  await f.instance.handleQueryEvent(f.state, f.control, {
    type: 'system',
    subtype: 'local_command_output',
    content: 'No goal set',
    uuid: 'output'
  })
  assert.equal(await result, null)
  assert.equal(f.state.queuedMessagesPaused, true)
})

test('requests serialize per chat and timeout without inventing goal state', async () => {
  const f = setup({ reply: false })
  const result = f.instance.setChatGoal('session', 'Tests pass')
  await new Promise(setImmediate)
  await assert.rejects(f.instance.setChatGoal('session', 'Another goal'), /already in progress/)
  await assert.rejects(result, /did not acknowledge/)
  assert.equal(f.state.goal, null)
  assert.equal(f.pins, 0)
})

test('a timed out unsent command is removed and cannot become a hidden retry', async () => {
  const f = setup({ reply: false })
  f.state.queuedMessagesPaused = true
  f.instance.drainNextQueuedMessage = async () => false
  const before = f.updates.length
  await assert.rejects(f.instance.setChatGoal('session', 'Tests pass'), /did not acknowledge/)
  assert.equal(f.state.queuedMessages.length, 0)
  assert.equal(f.state.queuedMessagesPaused, true)
  assert.ok(f.updates.length > before)
})

test('set confirmation alone cannot fabricate active state without the native event', async () => {
  const f = setup({ reply: false })
  const result = f.instance.setChatGoal('session', 'Tests pass')
  await new Promise(setImmediate)
  await f.instance.handleQueryEvent(f.state, f.control, {
    type: 'system',
    subtype: 'local_command_output',
    content: 'Goal set: Tests pass',
    uuid: 'output'
  })
  await assert.rejects(result, /did not acknowledge/)
  assert.equal(f.state.goal, null)
})
