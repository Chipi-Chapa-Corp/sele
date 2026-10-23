import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'sele-copilot-browser-'))
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
      name: 'browser-lifecycle-fixture',
      setup(builder) {
        builder.onResolve(
          { filter: /(?:BrowserAutomation|BrowserMcpServer|SqliteUsageReader|pendingMessages)$/ },
          (args) => ({ path: args.path.split('/').at(-1), namespace: 'fixture' })
        )
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: {
            BrowserAutomation:
              'export const getBrowserAutomationService = () => globalThis.__seleCopilotBrowser.service',
            BrowserMcpServer:
              'export const createBrowserMcpServer = (...args) => globalThis.__seleCopilotBrowser.create(...args)',
            SqliteUsageReader: 'export class SqliteUsageReader { dispose() {} }',
            pendingMessages:
              'export const sqlitePendingMessageBackend = { read: async () => [], replace: async () => {} }'
          }[args.path]
        }))
      }
    }
  ]
})
const { CopilotProviderAdapter } = createRequire(import.meta.url)(join(directory, 'adapter.cjs'))
test.after(async () => {
  delete globalThis.__seleCopilotBrowser
  await rm(directory, { recursive: true, force: true })
})
const fixture = () => {
  const bridges = []
  const configurations = []
  const service = {}
  globalThis.__seleCopilotBrowser = {
    service,
    async create(service, scope, options) {
      const bridge = {
        scope,
        options,
        url: 'http://127.0.0.1:1234/mcp',
        token: 'secret',
        suspended: 0,
        resumed: 0,
        closed: false,
        suspend() {
          this.suspended++
        },
        resume() {
          this.resumed++
        },
        async close() {
          this.closed = true
        }
      }
      bridges.push(bridge)
      return bridge
    }
  }
  const session = { async send() {}, async abort() {}, async disconnect() {}, async setModel() {} }
  const client = {
    async createSession(config) {
      configurations.push(config)
      return session
    },
    async resumeSession(id, config) {
      configurations.push(config)
      return session
    },
    async getSessionMetadata(sessionId) {
      return { sessionId, context: { workingDirectory: '/project' } }
    }
  }
  const adapter = new CopilotProviderAdapter()
  adapter.ensureClient = async () => client
  for (const method of [
    'loadSessionTitle',
    'loadEvents',
    'addAdditionalDirectories',
    'refreshPendingMessages',
    'refreshPlan'
  ])
    adapter[method] = async () => {}
  adapter.emitUpdate = () => {}
  adapter.createChatDetail = (state) => ({ id: state.id })
  adapter.startChatTitleGeneration = () => {}
  return { adapter, bridges, configurations, client }
}

test('Copilot creates and resumes session-local MCP config with scope and native permission callback', async () => {
  const { adapter, bridges, configurations } = fixture()
  const options = { cwd: '/project', sandboxMode: 'workspace-write', approvalPolicy: 'ask-user' }
  const state = adapter.createState('chat', options)
  await adapter.createSession(state, options)
  assert.deepEqual(bridges[0].scope, {
    providerId: 'copilot',
    sessionId: 'chat',
    cwd: '/project',
    containerKey: 'host'
  })
  assert.deepEqual(configurations[0].mcpServers.Sele_Browser, {
    type: 'http',
    url: bridges[0].url,
    headers: { Authorization: 'Bearer secret' },
    tools: ['*']
  })
  const approval = configurations[0].onPermissionRequest({
    kind: 'mcp',
    serverName: 'Sele_Browser',
    toolName: 'navigate',
    readOnly: false
  })
  assert.equal(state.pendingPermissions.length, 1)
  await adapter.resolveApproval('chat', 'deny')
  assert.deepEqual(await approval, { kind: 'reject' })
  await adapter.stopChat('chat')
  assert.ok(bridges[0].suspended > 0)
  await adapter.continueChat('chat', 'continue', options)
  assert.equal(bridges[0].resumed, 1)
  state.session = null
  await adapter.ensureSession('chat', options)
  assert.equal(bridges[0].closed, true)
  assert.equal(configurations[1].mcpServers.Sele_Browser.type, 'http')
  adapter.dispose()
  assert.equal(bridges[1].closed, true)
})

test('read-only, one-shot and container sessions do not receive the host browser', async () => {
  for (const [options, interactive] of [
    [{ cwd: '/project', sandboxMode: 'read-only' }, true],
    [{ cwd: '/project' }, false],
    [{ cwd: '/project', container: { kind: 'container', tool: 'docker', name: 'remote' } }, true]
  ]) {
    const { adapter, bridges, configurations } = fixture()
    const state = adapter.createState('chat', options)
    await adapter.createSession(state, options, interactive)
    assert.equal(bridges.length, 0)
    assert.equal(configurations[0].mcpServers, undefined)
    adapter.dispose()
  }
})

test('cwd and policy changes revoke old capability and rebuild runtime MCP registration', async () => {
  const { adapter, bridges, configurations } = fixture()
  const state = adapter.createState('chat', { cwd: '/project' })
  await adapter.createSession(state, state.options)
  state.options = { cwd: '/other' }
  assert.throws(() => bridges[0].options.authorizeTool('tabs_context', {}), /unavailable/)
  await adapter.ensureSession('chat', state.options)
  assert.equal(bridges[0].closed, true)
  assert.equal(bridges[1].scope.cwd, '/other')
  await adapter.ensureSession('chat', { cwd: '/other', sandboxMode: 'read-only' })
  assert.equal(bridges[1].closed, true)
  assert.equal(configurations[2].mcpServers, undefined)
  adapter.dispose()
})
