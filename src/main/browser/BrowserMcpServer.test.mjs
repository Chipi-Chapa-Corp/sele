import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { request } from 'node:http'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const directory = await mkdtemp(join(tmpdir(), 'sele-browser-mcp-'))
await symlink(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'), 'dir')
await build({
  entryPoints: ['src/main/browser/BrowserMcpServer.ts'],
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
const { createBrowserMcpServer } = createRequire(import.meta.url)(join(directory, 'bridge.cjs'))
test.after(() => rm(directory, { recursive: true, force: true }))

const scope = { providerId: 'copilot', sessionId: 'chat', cwd: '/project', containerKey: 'host' }
const fixture = () => {
  const clients = []
  const service = {
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
  return { service, clients }
}
const connect = async (bridge, t) => {
  const client = new Client({ name: 'sele-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(bridge.url), {
      requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } }
    })
  )
  t.after(() => client.close())
  return client
}
const text = (result) =>
  result.content.map((item) => (item.type === 'text' ? item.text : '')).join('')

test('HTTP transport requires token and exact host and rejects browser origins', async (t) => {
  const { service } = fixture()
  const bridge = await createBrowserMcpServer(service, scope)
  t.after(() => bridge.close())
  for (const headers of [
    {},
    { Authorization: 'Bearer wrong' },
    { Authorization: `Bearer ${bridge.token}`, Origin: 'https://attacker.example' }
  ]) {
    assert.equal((await fetch(bridge.url, { method: 'POST', headers, body: '{}' })).status, 403)
  }
  const badHost = await new Promise((resolve, reject) => {
    const call = request(
      bridge.url,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bridge.token}`, Host: 'attacker.example' }
      },
      (response) => {
        response.resume()
        resolve(response.statusCode)
      }
    )
    call.on('error', reject)
    call.end('{}')
  })
  assert.equal(badHost, 403)
  assert.equal(
    (await fetch(bridge.url, { headers: { Authorization: `Bearer ${bridge.token}` } })).status,
    405
  )
})

test('real MCP discovery, schema validation, suspension, fresh capability and close', async (t) => {
  const { service, clients } = fixture()
  const mutableScope = { ...scope }
  const bridge = await createBrowserMcpServer(service, mutableScope)
  t.after(() => bridge.close())
  const client = await connect(bridge, t)
  const tools = await client.listTools()
  for (const name of [
    'tabs_context',
    'navigate',
    'computer',
    'upload_files',
    'downloads',
    'print_pdf',
    'record_gif'
  ]) {
    assert.ok(
      tools.tools.some((tool) => tool.name === name),
      name
    )
  }
  assert.match(text(await client.callTool({ name: 'tabs_context' })), /chat/)
  const invalid = await client.callTool({ name: 'tabs_close', arguments: { tabId: -1 } })
  assert.equal(invalid.isError, true)
  assert.equal(clients[0].calls, 1)
  mutableScope.sessionId = 'other'
  bridge.suspend()
  assert.equal(clients[0].closed, true)
  assert.equal((await client.callTool({ name: 'tabs_context' })).isError, true)
  bridge.resume()
  assert.equal(clients.length, 2)
  assert.equal(clients[1].scope.sessionId, 'chat')
  assert.match(text(await client.callTool({ name: 'tabs_context' })), /chat/)
  await bridge.close()
  assert.equal(clients[1].closed, true)
  await assert.rejects(fetch(bridge.url))
})

test('OpenCode caller metadata fails closed and tokens cannot cross endpoints', async (t) => {
  const { service, clients } = fixture()
  const bridge = await createBrowserMcpServer(
    service,
    { ...scope, providerId: 'opencode' },
    { requireSessionMetadata: true }
  )
  const sibling = await createBrowserMcpServer(service, { ...scope, sessionId: 'sibling' })
  t.after(() => bridge.close())
  t.after(() => sibling.close())
  const client = await connect(bridge, t)
  for (const call of [
    { name: 'tabs_context' },
    { name: 'tabs_context', arguments: { sessionId: 'chat' } },
    { name: 'tabs_context', _meta: { 'ai.opencode/sessionID': 'sibling' } }
  ]) {
    assert.equal((await client.callTool(call)).isError, true)
  }
  assert.equal(clients[0].calls, 0)
  assert.match(
    text(
      await client.callTool({ name: 'tabs_context', _meta: { 'ai.opencode/sessionID': 'chat' } })
    ),
    /chat/
  )
  assert.equal(
    (
      await fetch(sibling.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bridge.token}` },
        body: '{}'
      })
    ).status,
    403
  )
})

test('revocation during asynchronous authorization cannot execute a newly resumed workspace', async (t) => {
  const { service, clients } = fixture()
  let release
  let entered
  const ready = new Promise((resolve) => {
    entered = resolve
  })
  const approval = new Promise((resolve) => {
    release = resolve
  })
  const bridge = await createBrowserMcpServer(service, scope, {
    authorizeTool: async () => {
      entered()
      await approval
    }
  })
  t.after(() => bridge.close())
  const client = await connect(bridge, t)
  const pending = client.callTool({ name: 'tabs_context' })
  await ready
  bridge.suspend()
  bridge.resume()
  release()
  assert.equal((await pending).isError, true)
  assert.ok(clients.every((client) => client.calls === 0))
})
