import { getContainerTargetKey } from '../../containerTarget.ts'
import { supportsLocalHostTools } from '../hostToolTarget.ts'
import { usesNativeChrome } from '../nativeChrome.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

// Exercise the actual query admission/disposal methods without Electron, a CLI, or inference.
const source = ts.createSourceFile(
  'ClaudeProviderAdapter.ts',
  readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const adapter = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name.text === 'ClaudeProviderAdapter'
)
const members = new Set(['startStateQuery', 'closeStateQuery', 'ensureStateQuery'])
const code = ts.transpileModule(
  `class Harness { ${adapter.members
    .filter((member) => members.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

function setup({
  remote = false,
  container = null,
  readOnly = false,
  failQuery = false,
  nativeChrome = false
} = {}) {
  const events = []
  let queryOptions
  const permissionHandler = async () => ({ behavior: 'deny', message: 'test permission policy' })
  const integration = {
    server: { type: 'sdk', name: 'Claude_Browser' },
    close: () => events.push('browser.close')
  }
  const control = { close: () => events.push('query.close') }
  const context = vm.createContext({
    supportsLocalHostTools,
    usesNativeChrome,
    clearTimeout,
    AsyncMessageQueue: class {
      close() {
        events.push('input.close')
      }
    },
    getBrowserAutomationService: () => ({}),
    createClaudeTerminalSessions: () => ({ dispose: () => events.push('terminals.close') }),
    createClaudeBrowserIntegration: (_service, scope, nativeChrome) => {
      events.push(['browser.create', scope, nativeChrome])
      return integration
    },
    claudeBrowserServerName: 'Claude_Browser',
    getContainerTargetKey,
    getClaudeModel: () => 'model',
    isExpectedClaudeQueryShutdownError: () => false,
    query: ({ options }) => {
      queryOptions = options
      if (failQuery) throw new Error('query startup failed')
      return control
    }
  })
  vm.runInContext(code, context)
  const instance = new context.Harness()
  const state = {
    id: 'session',
    query: null,
    browser: null,
    queryStartupRevision: 0,
    options: {
      cwd: '/project',
      sandboxMode: readOnly ? 'read-only' : 'workspace-write',
      nativeChrome
    },
    cwd: '/project',
    container: remote ? { kind: 'container', tool: 'ssh', name: 'remote' } : container,
    messages: [],
    backgroundTaskIds: new Set(),
    partialMessages: new Map()
  }
  instance.getTitle = () => 'Fixture chat'
  instance.states = new Map([[state.id, state]])
  instance.stateGeneration = 1
  instance.disposed = false
  instance.pinState = instance.unpinState = instance.trimIdleStates = () => {}
  instance.getQueryRuntime = async () => ({})
  instance.getBaseQueryOptions = () => ({ permissionMode: 'default' })
  instance.createElicitationHandler = () => async () => ({ action: 'cancel' })
  instance.createPermissionHandler = () => permissionHandler
  instance.consumeStateQuery = () => events.push('consume')
  instance.rejectPendingRequests = () => events.push('rejectPending')
  return {
    instance,
    state,
    events,
    integration,
    control,
    permissionHandler,
    options: () => queryOptions
  }
}

test('local interactive Claude queries receive only SDK MCP registration and retain permission handler', async () => {
  const harness = setup()
  await harness.instance.startStateQuery(harness.state)
  assert.equal(harness.options().mcpServers.Claude_Browser, harness.integration.server)
  assert.equal(harness.options().canUseTool, harness.permissionHandler)
  assert.equal(harness.options().permissionMode, 'default')
  assert.equal(harness.options().allowedTools, undefined)
  assert.equal(harness.state.browser, harness.integration)
  assert.equal(harness.events[0][1].providerId, 'claude')
  assert.equal(harness.events[0][1].sessionId, 'session')
  assert.equal(harness.events[0][1].cwd, '/project')
  await harness.instance.closeStateQuery(harness.state)
  assert.equal(harness.state.browser, null)
  assert.equal(harness.state.query, null)
  assert.ok(harness.events.indexOf('browser.close') < harness.events.indexOf('query.close'))
})

test('remote and read-only Claude queries cannot acquire the local browser capability', async () => {
  for (const options of [{ remote: true }, { readOnly: true }]) {
    const harness = setup(options)
    await harness.instance.startStateQuery(harness.state)
    assert.equal(harness.state.browser, null)
    assert.equal(harness.options().mcpServers, undefined)
    assert.ok(!harness.events.some((event) => Array.isArray(event)))
  }
})

test('official Claude Chrome attaches only to local writable interactive queries', async () => {
  const local = setup({ nativeChrome: true })
  await local.instance.startStateQuery(local.state)
  assert.deepEqual(Object.keys(local.options().extraArgs), ['chrome'])
  assert.equal(local.events.find((event) => Array.isArray(event))[2], true)
  assert.equal(local.state.queryNativeChrome, true)
  await local.instance.closeStateQuery(local.state)
  assert.equal(local.state.queryNativeChrome, null)
  for (const options of [
    {},
    { readOnly: true },
    { remote: true },
    { container: { kind: 'container', tool: 'distrobox', name: 'dev' } }
  ]) {
    const harness = setup({ ...options, nativeChrome: Boolean(Object.keys(options).length) })
    await harness.instance.startStateQuery(harness.state)
    assert.deepEqual(Object.keys(harness.options().extraArgs), ['no-chrome'])
    assert.equal(harness.state.queryNativeChrome, false)
    await harness.instance.closeStateQuery(harness.state)
  }
})

test('an idle Claude query restarts when official Chrome is enabled or disabled', async () => {
  const harness = setup()
  await harness.instance.startStateQuery(harness.state)
  const options = { ...harness.state.options, nativeChrome: true }
  await harness.instance.ensureStateQuery(harness.state, options)
  assert.equal(harness.state.queryNativeChrome, true)
  assert.deepEqual(Object.keys(harness.options().extraArgs), ['chrome'])
  await harness.instance.ensureStateQuery(harness.state, { ...options, nativeChrome: false })
  assert.equal(harness.state.queryNativeChrome, false)
  assert.deepEqual(Object.keys(harness.options().extraArgs), ['no-chrome'])
  assert.equal(harness.events.filter((event) => event === 'query.close').length, 2)
  await harness.instance.closeStateQuery(harness.state)
})

test('Claude local container queries receive all host tools with their real workspace scope', async () => {
  for (const tool of ['distrobox', 'toolbox']) {
    const harness = setup({ container: { kind: 'container', tool, name: 'dev' } })
    await harness.instance.startStateQuery(harness.state)
    assert.equal(harness.options().mcpServers.Claude_Browser, harness.integration.server)
    assert.equal(harness.events[0][1].cwd, '/project')
    assert.equal(harness.events[0][1].containerKey, `${tool}:dev`)
    await harness.instance.closeStateQuery(harness.state)
    assert.ok(harness.events.includes('browser.close'))
  }
})

test('failed SDK query construction revokes the browser integration', async () => {
  const harness = setup({ failQuery: true })
  await assert.rejects(harness.instance.startStateQuery(harness.state), /startup failed/)
  assert.ok(harness.events.includes('browser.close'))
  assert.ok(harness.events.includes('input.close'))
  assert.equal(harness.state.browser, null)
  assert.equal(harness.state.query, null)
})

test('closing an orphaned browser integration still revokes it without a query', async () => {
  const harness = setup()
  harness.state.browser = harness.integration
  await harness.instance.closeStateQuery(harness.state)
  assert.deepEqual(harness.events, ['browser.close'])
  assert.equal(harness.state.browser, null)
})

test('canceling query startup during runtime discovery never creates a browser capability', async () => {
  const harness = setup()
  harness.instance.getQueryRuntime = async () => {
    harness.instance.disposed = true
    return {}
  }
  await assert.rejects(harness.instance.startStateQuery(harness.state), /startup was canceled/)
  assert.deepEqual(harness.events, ['input.close'])
})
