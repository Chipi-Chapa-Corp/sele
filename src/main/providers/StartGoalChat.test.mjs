import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { CodexGoals } from './codex/CodexGoals.ts'
import { getClaudeGoalCommand } from './claude/ClaudeGoals.ts'
import { getCopilotGoalInput } from './copilot/CopilotGoals.ts'

// Run the adapter startup methods without a user profile, native app, or model request.
const createAdapter = (provider, methods, globals = {}) => {
  const name = `${provider[0].toUpperCase()}${provider.slice(1)}ProviderAdapter`
  const source = ts.createSourceFile(
    `${name}.ts`,
    readFileSync(new URL(`./${provider}/${name}.ts`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === name
  )
  return vm.runInNewContext(
    ts.transpile(
      `new (class { ${declaration.members
        .filter((member) => methods.includes(member.name?.getText(source)))
        .map((member) => member.getText(source))
        .join('\n')} })()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    { ...globals, console }
  )
}

const options = {
  initialGoal: 'Checks pass',
  model: 'fixture',
  cwd: '/repo',
  container: { kind: 'container', name: 'fixture' },
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write'
}

for (const provider of ['claude', 'copilot']) {
  test(`${provider} creates the session before invoking its native goal, without an ordinary send`, async () => {
    const calls = []
    const state = { id: 'chat', container: options.container }
    const adapter = createAdapter(provider, ['startChat'], {
      randomUUID: () => 'chat',
      getClaudeGoalCommand,
      getCopilotGoalInput,
      getMessageOptions: () => assert.fail('must use the native goal command')
    })
    Object.assign(adapter, {
      states: new Map(),
      sessionContainers: new Map(),
      pendingMessageStore: { track: (id) => calls.push(['track', id]) },
      createState: (id, settings) => {
        assert.equal(id, 'chat')
        assert.equal(settings, options)
        return state
      },
      requireAuthentication() {},
      startStateQuery: async () => calls.push(['session']),
      createSession: async () => {
        calls.push(['session'])
        return { send: () => assert.fail('must not send an extra prompt') }
      },
      setChatGoal: async (id, objective, source) => {
        calls.push(['goal', id, objective, source.container])
        state.goal = { objective, status: 'active' }
      },
      sendMessageNow: () => assert.fail('must not send an extra prompt'),
      scheduleSessionMetadataRefresh() {},
      startChatTitleGeneration() {},
      createChatDetail: () => ({ id: 'chat', goal: state.goal })
    })
    const result = await adapter.startChat('Checks pass', options, async (id) =>
      calls.push(['created', id])
    )
    assert.deepEqual(
      calls.map(([type]) => type),
      ['track', 'session', 'created', 'goal']
    )
    assert.deepEqual(calls.at(-1), ['goal', 'chat', 'Checks pass', options.container])
    assert.equal(result.goal.objective, 'Checks pass')
    adapter.setChatGoal = async () => {
      throw new Error('Goal unavailable')
    }
    await assert.rejects(adapter.startChat('Checks pass', options), /Goal unavailable/)
    await assert.rejects(
      adapter.startChat('off', { ...options, initialGoal: 'off' }),
      /reserved|completion condition/
    )
  })
}

test('Codex establishes the goal before admitting the first turn and stops on goal failure', async () => {
  const calls = []
  let failGoal = false
  const adapter = createAdapter('codex', ['startChat', 'startChatInContext'], {
    hasAttachmentInput: () => false,
    assertSupportedCodexHistory() {},
    getRecommendedPluginsConfig: () => ({}),
    getThreadAccessOptions: () => ({}),
    getThreadModelOptions: () => ({}),
    getTurnModelOptions: () => ({}),
    getTurnAccessOptions: () => ({}),
    getThreadTurns: () => [],
    createUserInput: (text) => [{ type: 'text', text }]
  })
  Object.assign(adapter, {
    goals: new CodexGoals(),
    runWithContainer: (container, run) => {
      assert.equal(container, options.container)
      return run()
    },
    client: {
      request: async (method, params) => {
        calls.push([method, params])
        if (method === 'thread/start') return { thread: { id: 'chat' } }
        if (method === 'thread/goal/set') {
          if (failGoal) throw new Error('Goal unavailable')
          return { goal: { objective: params.objective, status: 'active' } }
        }
        return { turn: { id: 'turn' } }
      }
    },
    rememberThreadContainer() {},
    resolveThreadCwd: async () => '/repo',
    resolveThreadName: async () => 'New chat',
    cacheThread() {},
    addSubmittedPendingTurn: async () => ({ id: 'pending' }),
    emitChatUpdated() {},
    startSubmittedCodexTurn: async (_id, _pending, run) => run(),
    removePendingTurn() {},
    startThreadTitleGeneration() {},
    getCachedChatDetail: () => ({ id: 'chat', goal: adapter.goals.get('chat') })
  })
  const detail = await adapter.startChat('Checks pass', options)
  assert.deepEqual(
    calls.map(([method]) => method),
    ['thread/start', 'thread/goal/set', 'turn/start']
  )
  assert.equal(detail.goal.objective, 'Checks pass')
  assert.equal(calls.at(-1)[1].input[0].text, 'Checks pass')
  calls.length = 0
  failGoal = true
  await assert.rejects(adapter.startChat('Checks pass', options), /Goal unavailable/)
  assert.deepEqual(
    calls.map(([method]) => method),
    ['thread/start', 'thread/goal/set']
  )
})
