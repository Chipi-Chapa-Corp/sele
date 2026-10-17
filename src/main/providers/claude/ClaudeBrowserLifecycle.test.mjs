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
const members = new Set(['startStateQuery', 'closeStateQuery'])
const code = ts.transpileModule(
  `class Harness { ${adapter.members
    .filter((member) => members.has(member.name?.getText(source)))
    .map((member) => member.getText(source))
    .join('\n')} }; globalThis.Harness = Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText

function setup({ remote = false, readOnly = false, failQuery = false } = {}) {
  const events = []
  let queryOptions
  const permissionHandler = async () => ({ behavior: 'deny', message: 'test permission policy' })
  const integration = {
    server: { type: 'sdk', name: 'Claude_Browser' },
    close: () => events.push('browser.close')
  }
  const control = { close: () => events.push('query.close') }
  const context = vm.createContext({
    AsyncMessageQueue: class {
      close() {
        events.push('input.close')
      }
    },
    getBrowserAutomationService: () => ({}),
    createClaudeBrowserIntegration: (_service, scope) => {
      events.push(['browser.create', scope])
      return integration
    },
    claudeBrowserServerName: 'Claude_Browser',
    getContainerTargetKey: (container) => (container ? 'remote' : 'host'),
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
    options: { cwd: '/project', sandboxMode: readOnly ? 'read-only' : 'workspace-write' },
    cwd: '/project',
    container: remote ? { name: 'remote' } : null,
    messages: [],
    backgroundTaskIds: new Set(),
    partialMessages: new Map()
  }
  instance.states = new Map([[state.id, state]])
  instance.stateGeneration = 1
  instance.disposed = false
  instance.pinState = instance.unpinState = instance.trimIdleStates = () => {}
  instance.getQueryRuntime = async () => ({})
  instance.getBaseQueryOptions = () => ({ permissionMode: 'default' })
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
