import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget.ts'
import { mapClaudeRateLimits } from './ClaudeUsage.ts'

const source = ts.createSourceFile(
  'ClaudeProviderAdapter.ts',
  readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const adapter = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'ClaudeProviderAdapter'
)
const methods = new Set(['changeAccount', 'getQueryRuntime', 'getBaseQueryOptions', 'getUsage'])
const code = ts.transpileModule(
  `class Harness { ${adapter.members
    .filter((member) => methods.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const selectionSource = ts.createSourceFile(
  'useWorkspaceSelection.tsx',
  readFileSync(
    new URL('../../../renderer/src/workspace/useWorkspaceSelection.tsx', import.meta.url),
    'utf8'
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let refreshCallback
const findRefresh = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(selectionSource) === 'refreshAccountUsage'
  ) {
    refreshCallback = node.initializer.arguments[0].getText(selectionSource)
  }
  ts.forEachChild(node, findRefresh)
}
findRefresh(selectionSource)

for (const fail of [false, true]) {
  test(`late manual usage ${fail ? 'errors' : 'results'} cannot replace the newly selected account`, async () => {
    const gate = deferred()
    const calls = []
    const scope = {}
    const scopeRef = { current: scope }
    const context = vm.createContext({
      usageProviderAvailable: true,
      usageProviderAvailabilityReady: true,
      usageProviderId: 'claude',
      changesContainer: null,
      normalizeContainerTarget,
      usageScope: scope,
      usageScopeRef: scopeRef,
      providerApi: {
        getUsage: async () => {
          await gate.promise
          if (fail) throw new Error('old account unavailable')
          return { rateLimits: ['old account'] }
        }
      },
      setAccountUsage: () => calls.push('usage'),
      setAccountUsageState: (value) => calls.push(value),
      setAccountUsageError: (value) => calls.push(value),
      console: { error: () => {} }
    })
    vm.runInContext(
      ts.transpileModule(`globalThis.refresh = ${refreshCallback}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 }
      }).outputText,
      context
    )
    const pending = context.refresh()
    assert.deepEqual(calls, ['loading', null])
    scopeRef.current = {}
    gate.resolve()
    await pending
    assert.deepEqual(calls, ['loading', null])
  })
}

const setup = () => {
  const calls = []
  const environment = {
    CLAUDE_CONFIG_DIR: '/shared',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '/accounts/a'
  }
  const context = vm.createContext({
    getContainerTargetKey,
    normalizeContainerTarget,
    mapClaudeRateLimits,
    emptyUsageSummary: {},
    console,
    getClaudeExecutable: () => 'claude',
    getHostExecutableCommand: async (file, args, options) => ({ file, args, env: options.env }),
    claudeAccounts: {
      getEnvironment: async () => ({ ...environment }),
      getUsageEnvironment: async () => ({ ...environment, CLAUDE_CONFIG_DIR: '/usage/a' }),
      getUsageFallback: async () => {
        calls.push(['usage-fallback'])
        return { seven_day: { utilization: 19, resets_at: null } }
      }
    },
    getClaudePermissionMode: () => 'default',
    getRuntimeEnvironment: (env) => env,
    getClaudeModel: () => undefined,
    toEffortLevel: () => undefined,
    getSandbox: () => ({ enabled: false }),
    spawn: (...args) => {
      calls.push(['spawn', ...args])
      return {}
    }
  })
  vm.runInContext(code, context)
  const h = new context.Harness()
  Object.assign(h, {
    accountChanges: new Map(),
    accountRevisions: new Map(),
    controlQueries: { invalidateKey: (key) => calls.push(['invalidate', key]) },
    modelDiscoveryRequests: new Map([['account:host', Promise.resolve([])]]),
    states: new Map(),
    oneShotGenerations: new Map(),
    stopChat: async (id) => {
      calls.push(['stop', id])
      const state = h.states.get(id)
      state.stopped = true
      state.active = false
      state.failed = false
    },
    closeStateQuery: async (state) => {
      calls.push(['close-idle', state.id])
      state.query = null
    }
  })
  return { h, calls, context, environment }
}

test('a null subscription SDK response falls back, while API-key and valid responses do not', async () => {
  const { h, calls } = setup()
  let response = { rate_limits_available: true, rate_limits: null }
  h.withControlQuery = async (_options, profile, run) => {
    assert.equal(profile, 'usage')
    return run({ usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => response })
  }
  const fallback = await h.getUsage()
  assert.equal(fallback.rateLimits[0].usedPercent, 19)
  assert.equal(calls.length, 1)
  response = { rate_limits_available: false, rate_limits: null }
  assert.equal((await h.getUsage()).rateLimits.length, 0)
  response = {
    rate_limits_available: true,
    rate_limits: { seven_day: { utilization: 7, resets_at: null } }
  }
  assert.equal((await h.getUsage()).rateLimits[0].usedPercent, 7)
  assert.equal(calls.length, 1)
})

test('switching closes only the selected environment and leaves transcript state intact', async () => {
  const { h, calls } = setup()
  const remote = { kind: 'container', tool: 'ssh', name: 'server' }
  const state = { id: 'local', container: null, active: true, messages: ['existing chat'] }
  h.states.set('local', state)
  h.states.set('remote', { id: 'remote', container: remote })
  const localGeneration = {
    container: null,
    canceled: false,
    query: { close: () => calls.push(['close-one-shot']) }
  }
  const remoteGeneration = { container: remote, canceled: false }
  h.oneShotGenerations.set('a', localGeneration)
  h.oneShotGenerations.set('b', remoteGeneration)
  await h.changeAccount(null, async () => calls.push(['commit']))
  assert.deepEqual(calls, [
    ['invalidate', 'account:host'],
    ['invalidate', 'apps:host'],
    ['invalidate', 'usage:host'],
    ['close-one-shot'],
    ['stop', 'local'],
    ['commit']
  ])
  assert.deepEqual(state.messages, ['existing chat'])
  assert.equal(localGeneration.canceled, true)
  assert.equal(remoteGeneration.canceled, false)
  assert.equal(h.modelDiscoveryRequests.has('account:host'), false)
})

for (const failed of [false, true]) {
  test(`switching preserves a ${failed ? 'failed' : 'finished'} turn and retires its idle query`, async () => {
    const { h, calls } = setup()
    const state = {
      id: 'hi',
      container: null,
      active: false,
      stopped: false,
      failed,
      queueDrainInProgress: false,
      pendingApprovals: [],
      pendingUserInputs: [],
      queuedMessages: [],
      queuedMessagesPaused: false,
      query: {},
      messages: [{ type: 'assistant', message: { content: 'Hello', stop_reason: 'end_turn' } }]
    }
    const messages = structuredClone(state.messages)
    h.states.set(state.id, state)
    await h.changeAccount(null, async () => {})
    assert.equal(state.stopped, false)
    assert.equal(state.failed, failed)
    assert.equal(state.query, null)
    assert.deepEqual(state.messages, messages)
    assert.ok(calls.some((call) => call[0] === 'close-idle'))
    assert.ok(!calls.some((call) => call[0] === 'stop'))
  })
}

test('switching stops a turn waiting for approval even when active is false', async () => {
  const { h, calls } = setup()
  h.states.set('approval', {
    id: 'approval',
    container: null,
    active: false,
    queueDrainInProgress: false,
    pendingApprovals: [{}],
    pendingUserInputs: [],
    queuedMessages: []
  })
  await h.changeAccount(null, async () => {})
  assert.ok(calls.some((call) => call[0] === 'stop' && call[1] === 'approval'))
})

test('only usage probes isolate config; chat runtimes keep shared history and the same credentials', async () => {
  const { h } = setup()
  const chat = await h.getQueryRuntime(null)
  const usage = await h.getQueryRuntime(null, undefined, true)
  assert.equal(chat.command.env.CLAUDE_CONFIG_DIR, '/shared')
  assert.equal(usage.command.env.CLAUDE_CONFIG_DIR, '/usage/a')
  assert.equal(
    usage.command.env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
    chat.command.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  )
})

test('a runtime resolved before switching cannot spawn a process afterward', async () => {
  const { h, calls } = setup()
  const runtime = await h.getQueryRuntime(null)
  const options = h.getBaseQueryOptions(undefined, runtime)
  await h.changeAccount(null, async () => {})
  assert.throws(() => options.spawnClaudeCodeProcess({ args: [], env: {} }), /account changed/)
  assert.equal(
    calls.some((call) => call[0] === 'spawn'),
    false
  )
})

test('runtime creation waits for switching and receives the new credential directory', async () => {
  const { h, environment } = setup()
  const gate = deferred()
  const changing = h.changeAccount(null, async () => {
    await gate.promise
    environment.CLAUDE_SECURESTORAGE_CONFIG_DIR = '/accounts/b'
  })
  const runtimePromise = h.getQueryRuntime(null)
  gate.resolve()
  await changing
  const runtime = await runtimePromise
  assert.equal(runtime.command.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, '/accounts/b')
  assert.equal(runtime.command.env.CLAUDE_CONFIG_DIR, '/shared')
})

test('a switch during executable resolution rejects the stale runtime', async () => {
  const { h, context } = setup()
  const gate = deferred()
  const started = deferred()
  context.getHostExecutableCommand = async (file, args, options) => {
    started.resolve()
    await gate.promise
    return { file, args, env: options.env }
  }
  const runtime = h.getQueryRuntime(null)
  await started.promise
  await h.changeAccount(null, async () => {})
  gate.resolve()
  await assert.rejects(runtime, /account changed/)
})

test('a failed switch releases the transition gate for the next attempt', async () => {
  const { h } = setup()
  await assert.rejects(
    h.changeAccount(null, async () => {
      throw new Error('disk full')
    }),
    /disk full/
  )
  await h.changeAccount(null, async () => {})
  assert.equal((await h.getQueryRuntime(null)).accountRevision, 2)
})
