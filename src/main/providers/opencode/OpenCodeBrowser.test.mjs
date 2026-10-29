import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'
import { build } from 'esbuild'
import { getOpenCodePermissionRules } from './OpenCodePermissions.ts'

const directory = await mkdtemp(join(tmpdir(), 'sele-opencode-browser-test-'))
await symlink(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'), 'dir')
await build({
  entryPoints: ['src/main/providers/opencode/OpenCodeBrowserBridge.ts'],
  outfile: join(directory, 'bridge.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'no-gui',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'fixture'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const nativeImage = {}'
        }))
      }
    }
  ]
})
const { createOpenCodeBrowserBridge } = createRequire(import.meta.url)(
  join(directory, 'bridge.cjs')
)
test.after(() => rm(directory, { recursive: true, force: true }))

const fixture = () => {
  const clients = []
  return {
    clients,
    service: {
      createClient(scope) {
        const client = {
          scope,
          closed: false,
          calls: 0,
          async listTabs() {
            assert.equal(this.closed, false)
            this.calls++
            return [{ id: 1, title: scope.sessionId, url: 'about:blank', active: true }]
          },
          close() {
            this.closed = true
          }
        }
        clients.push(client)
        return client
      }
    }
  }
}
const scope = (sessionId = 'chat', cwd = '/project') => ({
  providerId: 'opencode-v2',
  sessionId,
  cwd,
  containerKey: 'host'
})
const context = (sessionID = 'chat', directory = '/project', ask = async () => {}) => ({
  sessionID,
  directory,
  signal: new AbortController().signal,
  agent: 'build',
  messageID: 'message',
  id: 'tool',
  ask
})

test('generated plugin routes trusted runtime sessions, asks permission, revokes on suspend, and deletes secrets', async () => {
  const { service, clients } = fixture()
  const bridge = await createOpenCodeBrowserBridge(service)
  const browser = await bridge.register(scope())
  const path = join(bridge.pluginUrl, 'index.ts')
  try {
    const definitions = new Map()
    const approvals = []
    let callerDirectory = '/project'
    let permission = async (x) => approvals.push(x)
    const plugin = (await import(pathToFileURL(path).href)).default
    await plugin.setup({
      tool: {
        transform: async (edit) =>
          edit({ add: (definition) => definitions.set(definition.name, definition) })
      },
      permission: { assert: (input) => permission(input) },
      session: { get: async () => ({ location: { directory: callerDirectory } }) }
    })
    const tool = definitions.get('sele_browser_tabs_context')
    const result = await tool.execute(
      { sessionID: 'sibling' },
      context('chat', '/project', async (x) => approvals.push(x))
    )
    assert.match(result.content.map((x) => x.text ?? '').join(''), /chat/)
    assert.equal(approvals[0].action, 'sele_browser_tabs_context')
    assert.equal(clients.at(-1).calls, 1)
    await assert.rejects(tool.execute({}, context('sibling')), /unavailable/)
    callerDirectory = '/other-project'
    await assert.rejects(tool.execute({}, context('chat')), /unavailable/)
    callerDirectory = '/project'
    await assert.rejects(tool.execute({}, context('one-shot')), /unavailable/)
    permission = async () => {
      throw new Error('Permission denied')
    }
    await assert.rejects(tool.execute({}, context()), /Permission denied/)
    permission = async (x) => approvals.push(x)
    assert.equal(clients.at(-1).calls, 1)
    assert.deepEqual(definitions.get('sele_browser_navigate').input.required, ['url'])
    browser.suspend()
    assert.equal(clients.at(-1).closed, true)
    await assert.rejects(tool.execute({}, context()), /unavailable/)
    browser.resume()
    assert.match(JSON.stringify((await tool.execute({}, context())).content), /chat/)
    await browser.close()
    await assert.rejects(tool.execute({}, context()), /unavailable/)
  } finally {
    await bridge.close()
  }
  await assert.rejects(readFile(path), { code: 'ENOENT' })
})

test('OpenCode permissions exclude browser tools until explicitly bound to an interactive turn', () => {
  const browserRule = (options, enabled) =>
    getOpenCodePermissionRules(options, enabled).find((x) => x.permission === 'sele_browser_*')
  assert.equal(browserRule({ approvalPolicy: 'never' }).action, 'deny')
  assert.equal(browserRule({}, true).action, 'ask')
  assert.equal(browserRule({ approvalPolicy: 'never' }, true).action, 'allow')
  assert.equal(browserRule({ sandboxMode: 'read-only' }, true).action, 'deny')
})
