import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { CodexDynamicTools } from './CodexDynamicTools.ts'

const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents: `
      export { registerCodexBrowserTools } from './src/main/providers/codex/CodexBrowserTools';
      export * from './src/main/providers/codex/CodexBrowserSessions';
      export { setService } from './src/main/browser/BrowserAutomation';
    `,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'browser-fixture',
      setup(build) {
        build.onResolve({ filter: /^electron$|\/BrowserAutomation$/ }, (args) => ({
          path: args.path === 'electron' ? 'electron' : 'BrowserAutomation',
          namespace: 'fixture'
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'electron'
              ? 'export const nativeImage = {}'
              : 'let service; export const setService = value => {service = value}; export const getBrowserAutomationService = () => service'
        }))
      }
    }
  ]
})
const module = { exports: {} }
vm.runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  require,
  console,
  Buffer,
  process,
  setTimeout,
  clearTimeout,
  AbortController,
  structuredClone,
  URL
})
const api = module.exports

function fixture(t) {
  const clients = []
  const owner = {}
  api.setService({
    createClient(scope) {
      const tabs = []
      const client = {
        scope,
        closed: false,
        tabs,
        listTabs: async () => tabs,
        createTab: async () => {
          const tab = { id: clients.length, url: 'about:blank', title: 'New tab' }
          tabs.push(tab)
          return tab
        },
        activateTab: async (id) => {
          client.activeTab = id
        },
        visibility: async (visible) => {
          client.visible = visible
        },
        close: () => {
          client.closed = true
        }
      }
      clients.push(client)
      return client
    }
  })
  const registry = new CodexDynamicTools()
  const integration = api.registerCodexBrowserTools(registry)
  const bind = (id, cwd = '/project', container = null) => {
    registry.bind(id, registry.specs)
    api.registerBrowserUseSession(owner, id, cwd, container)
  }
  const call = (id, tool, args = {}) =>
    registry.call({
      threadId: id,
      turnId: 'turn',
      callId: 'call',
      namespace: 'sele_browser',
      tool,
      arguments: args
    })
  t.after(() => {
    integration.close()
    api.removeBrowserUseSessions(owner)
    api.setService(undefined)
  })
  return { clients, owner, registry, integration, bind, call }
}

test('Codex can discover and open visible Browser pane tabs without plugins or js_repl', async (t) => {
  const { registry, bind, call, clients } = fixture(t)
  const browser = registry.specs.find((spec) => spec.name === 'sele_browser')
  for (const name of ['tabs_context', 'tabs_create', 'navigate', 'read_page', 'computer'])
    assert.ok(
      browser.tools.some((tool) => tool.name === name),
      name
    )
  assert.match(browser.tools[0].description, /in-app Browser pane/)
  bind('no-project', '', { kind: 'container', tool: 'distrobox', name: 'dev' })
  const context = await call('no-project', 'tabs_context')
  assert.equal(context.success, true)
  assert.deepEqual(JSON.parse(context.contentItems[0].text), { tabs: [] })
  const result = await call('no-project', 'tabs_create', { foreground: true })
  assert.equal(result.success, true)
  const client = clients.at(-1)
  assert.equal(client.scope.sessionId, 'no-project')
  assert.equal(client.scope.cwd, '')
  assert.equal(client.scope.containerKey, 'distrobox:dev')
  assert.equal(client.visible, true)
  assert.equal(client.activeTab, JSON.parse(result.contentItems[0].text).id)
})

test('browser clients keep conversation scopes and revoke on scope replacement or disconnect', async (t) => {
  const { bind, call, clients, owner, integration } = fixture(t)
  bind('first', '/first')
  bind('second', '/second')
  await call('first', 'tabs_context')
  const first = clients.at(-1)
  await call('second', 'tabs_context')
  const second = clients.at(-1)
  assert.notEqual(first, second)
  assert.equal(first.scope.cwd, '/first')
  assert.equal(second.scope.cwd, '/second')
  bind('first', '/replacement')
  assert.equal(first.closed, true)
  assert.equal(second.closed, false)
  await call('first', 'tabs_context')
  assert.equal(clients.at(-1).scope.cwd, '/replacement')
  integration.close()
  assert.ok(clients.every((client) => client.closed))
  // Like the desktop integration, registration survives a transport reconnect.
  await call('second', 'tabs_context')
  const reconnected = clients.at(-1)
  assert.equal(reconnected.closed, false)
  api.removeBrowserUseSessions(owner)
  assert.equal(reconnected.closed, true)
})

test('unowned, read-only, and SSH conversations cannot execute browser tools', async (t) => {
  const { bind, call, registry, clients } = fixture(t)
  registry.bind('unowned', registry.specs)
  bind('read-only')
  registry.setReadOnly('read-only', true)
  bind('ssh', '/remote', { kind: 'container', tool: 'ssh', name: 'remote' })
  for (const id of ['unowned', 'read-only', 'ssh']) {
    const result = await call(id, 'tabs_context')
    assert.equal(result.success, false, id)
  }
  assert.equal(clients.length, 1, 'only the closed schema-definition client was created')
})

test('browser tools are absent when the browser service is unavailable', () => {
  const registry = new CodexDynamicTools()
  api.setService(undefined)
  assert.equal(api.registerCodexBrowserTools(registry), null)
  assert.equal(registry.specs.length, 0)
})
