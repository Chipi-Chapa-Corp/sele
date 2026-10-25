import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import test from 'node:test'
import { build } from 'esbuild'
import { CopilotClient } from '@github/copilot-sdk'
import { getCopilotGoalInput, mapCopilotGoal, runCopilotGoal } from './CopilotGoals.ts'

const directory = await mkdtemp(join(tmpdir(), 'sele-copilot-goals-'))
await symlink(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'), 'dir')
await build({
  entryPoints: ['src/main/providers/copilot/CopilotProviderAdapter.ts'],
  outfile: join(directory, 'adapter.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'goal-fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /(?:BrowserAutomation|BrowserMcpServer|SqliteUsageReader)$/ },
          (args) => ({ path: args.path.split('/').at(-1), namespace: 'fixture' })
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents: {
            BrowserAutomation: 'export const getBrowserAutomationService = () => null',
            BrowserMcpServer: 'export const createBrowserMcpServer = async () => null',
            SqliteUsageReader: 'export class SqliteUsageReader { dispose() {} }'
          }[path]
        }))
      }
    }
  ]
})
const { CopilotProviderAdapter } = createRequire(import.meta.url)(join(directory, 'adapter.cjs'))
test.after(() => rm(directory, { recursive: true, force: true }))
const tick = () => new Promise(setImmediate)
const goal = (objective = 'Checks pass', status = 'active', id = 1) => ({
  id,
  objective,
  status,
  turnCount: 1,
  creditCountNanoAiu: '1000000000'
})

test('conditions preserve multiline text and exclude command control syntax', () => {
  assert.equal(
    getCopilotGoalInput('  Checks pass\nand lint passes  '),
    'Checks pass\nand lint passes'
  )
  for (const value of [null, '', '  ']) assert.equal(getCopilotGoalInput(value), null)
  for (const value of ['ON', 'off', '--max-ai-credits 2', 'Tests pass --max-ai-credits=2'])
    assert.throws(() => getCopilotGoalInput(value), /completion condition/)
})

test('maps native lifecycle and preserves identity without treating credits as tokens', () => {
  const first = mapCopilotGoal('chat', goal(), undefined, 1000)
  assert.equal(first.status, 'active')
  assert.equal(first.tokenBudget, null)
  assert.equal(first.tokensUsed, 0)
  assert.equal(
    mapCopilotGoal('chat', goal('Checks pass', 'paused'), { id: 1, goal: first }, 2000).createdAt,
    1000
  )
  assert.equal(mapCopilotGoal('chat', goal('Checks pass', 'completed')).status, 'complete')
  assert.equal(
    mapCopilotGoal('chat', goal('New goal', 'active', 2), { id: 1, goal: first }, 2000).createdAt,
    2000
  )
  assert.equal(mapCopilotGoal('chat', null), null)
})

const fixture = () => {
  const adapter = new CopilotProviderAdapter()
  const state = adapter.createState('chat')
  const sent = [],
    invocations = [],
    finalized = [],
    updates = []
  let current = null,
    aborts = 0
  const session = {
    async abort() {
      aborts++
      state.active = false
      state.stopped = true
    },
    async send(message) {
      sent.push(message)
      return 'sent'
    },
    rpc: {
      autopilotObjective: {
        async getState() {
          return { state: current }
        }
      },
      mode: {
        async get() {
          return current?.status === 'active' ? 'autopilot' : 'interactive'
        }
      },
      commands: {
        async list() {
          return { commands: [{ name: 'autopilot', aliases: ['goal'], kind: 'builtin' }] }
        },
        async invoke(args) {
          invocations.push(args)
          if (args.input === 'off') {
            if (current) current = { ...current, status: 'paused', pauseReason: 'autopilot_off' }
            return { kind: 'completed' }
          }
          current = goal(args.input, 'active', (current?.id ?? 0) + 1)
          return {
            kind: 'agent-prompt',
            prompt: `Native directive: ${args.input}`,
            displayPrompt: `Goal: ${args.input}`,
            mode: 'autopilot',
            reservationToken: 'reservation'
          }
        },
        async finalizeInvocationEffect(effect) {
          finalized.push(effect.outcome)
          return { success: true }
        }
      }
    }
  }
  session.internalRpc = {
    commands: { finalizeInvocationEffect: session.rpc.commands.finalizeInvocationEffect }
  }
  state.session = session
  adapter.ensureSession = async () => state
  adapter.emitUpdate = () => updates.push(adapter.createChatDetail(state))
  adapter.scheduleQueueDrain = () => {}
  adapter.storeEvent = () => {}
  adapter.reportEventTokenUsage = () => {}
  adapter.queueUpdate = () => {}
  return {
    adapter,
    state,
    session,
    sent,
    invocations,
    finalized,
    updates,
    get aborts() {
      return aborts
    },
    set current(value) {
      current = value
    },
    get current() {
      return current
    }
  }
}

test('adapter enables goals, sets/refocuses using native prompt, and stops with paused state', async () => {
  const f = fixture()
  f.state.options = {
    model: 'selected',
    sandboxMode: 'read-only',
    skills: [{ name: 'old' }],
    files: [{ path: '/old' }]
  }
  assert.equal((await f.adapter.setChatGoal('chat', 'Checks pass')).status, 'active')
  assert.equal(f.updates.at(-1).capabilities.setGoal, true)
  assert.deepEqual(f.sent[0], {
    prompt: 'Native directive: Checks pass',
    displayPrompt: 'Goal: Checks pass',
    agentMode: 'autopilot'
  })
  assert.equal(f.state.options.sandboxMode, 'read-only')
  assert.equal((await f.adapter.setChatGoal('chat', 'Lint passes')).objective, 'Lint passes')
  assert.equal(f.aborts, 1)
  assert.equal((await f.adapter.setChatGoal('chat', null)).status, 'paused')
  assert.equal(f.aborts, 2)
  assert.equal(f.sent.length, 2)
  assert.equal(f.invocations.at(-1).input, 'off')
  assert.deepEqual(f.finalized, ['applied', 'applied'])
})

test('discovery hides controls for older runtimes and does not break chat loading', async () => {
  const f = fixture()
  f.session.rpc.autopilotObjective = undefined
  await f.adapter.refreshGoal(f.state)
  assert.equal(f.adapter.createChatDetail(f.state).capabilities.setGoal, false)
  await assert.rejects(f.adapter.setChatGoal('chat', 'Checks pass'), /does not support/)
  assert.equal(f.sent.length, 0)
})

test('SDK workflow permissions and legacy external factory permissions remain reviewable', () => {
  const f = fixture()
  for (const kind of ['workflow', 'factory']) {
    f.state.pendingPermissions = [
      {
        id: 'permission',
        startedAt: 1,
        request: { kind, name: 'fixture', description: 'Fixture operation' }
      }
    ]
    const approval = f.adapter.createChatDetail(f.state).pendingApproval
    assert.equal(approval.command, 'Fixture operation')
    assert.match(approval.reason, new RegExp(kind))
  }
})

test('native objective events recover and update state, including completed goals', async () => {
  const f = fixture()
  f.current = goal('Recovered goal')
  await f.adapter.refreshGoal(f.state)
  assert.equal(f.adapter.createChatDetail(f.state).goal.objective, 'Recovered goal')
  f.current = goal('Recovered goal', 'completed')
  f.adapter.handleEvent('chat', {
    type: 'session.autopilot_objective_changed',
    data: { operation: 'update' }
  })
  await tick()
  assert.equal(f.updates.at(-1).goal.status, 'complete')
})

test('a temporary read failure retains known controls for an active goal', async () => {
  const f = fixture()
  f.current = goal()
  await f.adapter.refreshGoal(f.state)
  f.session.rpc.autopilotObjective.getState = async () => {
    throw new Error('Temporary fixture failure')
  }
  const warn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  try {
    await f.adapter.refreshGoal(f.state)
  } finally {
    console.warn = warn
  }
  const detail = f.adapter.createChatDetail(f.state)
  assert.equal(detail.capabilities.setGoal, true)
  assert.equal(detail.goal.status, 'active')
  assert.equal(warnings.length, 1)
})

test('late reads and replaced connections cannot restore stale goal state', async () => {
  const f = fixture()
  await f.adapter.refreshGoal(f.state)
  let release
  f.session.rpc.autopilotObjective.getState = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const stale = f.adapter.refreshGoal(f.state)
  f.session.rpc.autopilotObjective.getState = async () => ({ state: goal('New goal') })
  await f.adapter.refreshGoal(f.state)
  release({ state: goal('Old goal') })
  await stale
  assert.equal(f.state.goal.objective, 'New goal')
  const retired = f.adapter.refreshGoal(f.state)
  f.state.session = { rpc: {} }
  await retired
  assert.equal(f.state.goal.objective, 'New goal')
})

test('failed sends cancel native reservations and release queue/mutation locks', async () => {
  const f = fixture()
  f.state.queuePaused = true
  f.session.send = async () => {
    throw new Error('Disconnected')
  }
  await assert.rejects(f.adapter.setChatGoal('chat', 'Checks pass'), /Disconnected/)
  assert.deepEqual(f.finalized, ['cancelled'])
  assert.equal(f.state.goal.status, 'paused')
  assert.equal(f.state.active, false)
  assert.equal(f.state.goalMutation, false)
  assert.equal(f.state.queuePaused, true)
})

test('Stop during a pending command cancels its reservation without starting another turn', async () => {
  const f = fixture()
  const invoke = f.session.rpc.commands.invoke
  let release
  f.session.rpc.commands.invoke = async (args) => {
    const result = await invoke(args)
    if (args.input !== 'off')
      await new Promise((resolve) => {
        release = resolve
      })
    return result
  }
  const updating = f.adapter.setChatGoal('chat', 'Checks pass')
  await tick()
  f.adapter.refreshPendingMessages = async () => {}
  await f.adapter.stopChat('chat')
  release()
  await assert.rejects(updating, /was stopped/)
  assert.equal(f.sent.length, 0)
  assert.deepEqual(f.finalized, ['cancelled'])
  assert.equal(f.state.queuePaused, true)
})

test('concurrent goal saves cannot both mutate the native session', async () => {
  const f = fixture()
  let release
  f.session.send = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const first = f.adapter.setChatGoal('chat', 'First')
  await tick()
  await assert.rejects(f.adapter.setChatGoal('chat', 'Second'), /current Copilot update/)
  release('sent')
  await first
  assert.equal(f.invocations.length, 1)
})

test('bundled runtime accepts native goal reservations, replacement, rollback and off without model requests', {
  timeout: 15000
}, async () => {
  const profile = await mkdtemp(join(directory, 'native-'))
  const client = new CopilotClient({
    baseDirectory: profile,
    useLoggedInUser: false,
    env: { ...process.env, COPILOT_GITHUB_TELEMETRY_DISABLED: 'true' }
  })
  try {
    await client.start()
    const native = await client.createSession({
      workingDirectory: profile,
      model: 'fixture',
      provider: { type: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'fixture' },
      enableConfigDiscovery: false,
      availableTools: [],
      onPermissionRequest: async () => ({ kind: 'denied-interactively-by-user' })
    })
    const sent = []
    const session = {
      rpc: native.rpc,
      internalRpc: native.internalRpc,
      send: async (message) => {
        sent.push(message)
        return 'captured'
      }
    }
    await runCopilotGoal(session, 'autopilot', 'Native fixture goal', () => {})
    assert.equal(
      (await native.rpc.autopilotObjective.getState()).state.objective,
      'Native fixture goal'
    )
    await runCopilotGoal(session, 'autopilot', 'Revised fixture goal', () => {})
    assert.equal(sent.length, 2)
    assert.equal(sent[0].agentMode, 'autopilot')
    await assert.rejects(
      runCopilotGoal(
        {
          ...session,
          send: async () => {
            throw new Error('fixture send failure')
          }
        },
        'autopilot',
        'Rejected fixture goal',
        () => {}
      ),
      /fixture send failure/
    )
    assert.equal((await native.rpc.autopilotObjective.getState()).state?.status, 'paused')
    await runCopilotGoal(session, 'autopilot', null, () => {})
    assert.equal(await native.rpc.mode.get(), 'interactive')
    assert.notEqual((await native.rpc.autopilotObjective.getState()).state?.status, 'active')
  } finally {
    await client.stop()
  }
})

test('native goal submission reaches the configured model transport and can be interrupted', {
  timeout: 15000
}, async () => {
  const profile = await mkdtemp(join(directory, 'transport-'))
  let received
  const request = new Promise((resolve) => {
    received = resolve
  })
  const server = createServer(async (req, _res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    received(JSON.parse(body))
    // Hold the request open: check admission and abort without model inference.
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const client = new CopilotClient({
    baseDirectory: profile,
    useLoggedInUser: false,
    env: { ...process.env, COPILOT_GITHUB_TELEMETRY_DISABLED: 'true' }
  })
  let timeout
  try {
    await client.start()
    const native = await client.createSession({
      workingDirectory: profile,
      model: 'fixture',
      provider: {
        type: 'openai',
        wireApi: 'completions',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        apiKey: 'fixture'
      },
      enableConfigDiscovery: false,
      availableTools: [],
      onPermissionRequest: async () => ({ kind: 'denied-interactively-by-user' })
    })
    await runCopilotGoal(native, 'autopilot', 'Transport fixture condition', () => {})
    const body = await Promise.race([
      request,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Goal prompt did not reach the model transport')),
          5000
        )
      })
    ])
    assert.match(JSON.stringify(body.messages), /Transport fixture condition/)
    assert.equal((await native.rpc.autopilotObjective.getState()).state.status, 'active')
    await native.abort()
    await runCopilotGoal(native, 'autopilot', null, () => {})
    assert.equal(await native.rpc.mode.get(), 'interactive')
    await native.disconnect()
    const resumed = await client.resumeSession(native.sessionId, {
      workingDirectory: profile,
      model: 'fixture',
      provider: {
        type: 'openai',
        wireApi: 'completions',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        apiKey: 'fixture'
      },
      enableConfigDiscovery: false,
      availableTools: [],
      onPermissionRequest: async () => ({ kind: 'denied-interactively-by-user' })
    })
    const restored = (await resumed.rpc.autopilotObjective.getState()).state
    assert.equal(restored.objective, 'Transport fixture condition')
    assert.equal(restored.status, 'paused')
  } finally {
    clearTimeout(timeout)
    await client.stop()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
