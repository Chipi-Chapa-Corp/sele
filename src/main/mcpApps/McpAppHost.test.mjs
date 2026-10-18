import assert from 'node:assert/strict'
import test from 'node:test'
import { McpAppHost, getMcpAppHtml, getMcpAppCsp } from './McpAppHost.ts'
const resource = {
  uri: 'ui://test/app.html',
  mimeType: 'text/html;profile=mcp-app',
  text: '<p>Widget</p>',
  _meta: {
    ui: {
      csp: {
        resourceDomains: [
          'https://cdn.example.com',
          'https://bad.com; script-src *',
          'file:///etc'
        ],
        connectDomains: ['https://api.example.com']
      }
    }
  }
}
function fixture() {
  let live = true,
    writable = true
  const calls = []
  return {
    host: new McpAppHost(),
    calls,
    revoke: () => {
      live = false
    },
    readOnly: () => {
      writable = false
    },
    connection: {
      serverName: 'source',
      resourceUri: resource.uri,
      input: {},
      result: { content: [] },
      isCurrent: () => live,
      canCall: () => writable,
      readResource: async (uri) => ({ contents: [{ ...resource, uri }] }),
      listTools: async () => ({
        tools: [
          { name: 'allowed' },
          { name: 'model_only', _meta: { ui: { visibility: ['model'] } } }
        ]
      }),
      callTool: async (name, args) => {
        calls.push({ name, args })
        return { content: [{ type: 'text', text: 'Done' }] }
      }
    }
  }
}
test('MCP app documents have a strict MIME type, bounded HTML and a validated CSP', () => {
  assert.equal(getMcpAppHtml(resource), resource.text)
  assert.throws(() => getMcpAppHtml({ ...resource, mimeType: 'text/html' }), /not an MCP App/)
  assert.throws(() => getMcpAppHtml({ ...resource, text: 'x'.repeat(2000001) }), /exceeds/)
  const csp = getMcpAppCsp(resource)
  assert.match(csp, /https:\/\/cdn.example.com/)
  assert.match(csp, /connect-src https:\/\/api.example.com/)
  assert.doesNotMatch(csp, /bad.com|file:/)
  assert.match(csp, /object-src 'none'/)
})
test('MCP app capabilities bind the renderer, server, tool visibility and live session', async () => {
  const h = fixture()
  const view = await h.host.open(11, h.connection)
  assert.ok(h.host.document(view.id))
  await assert.rejects(h.host.request(12, view.id, 'tools/call', { name: 'allowed' }), /revoked/)
  await assert.rejects(
    h.host.request(11, view.id, 'tools/call', { name: 'model_only' }),
    /not callable/
  )
  await assert.rejects(
    h.host.request(11, view.id, 'resources/read', { uri: 'file:///etc/passwd' }),
    /Only app/
  )
  await h.host.request(11, view.id, 'tools/call', {
    name: 'allowed',
    serverName: 'different',
    arguments: { value: 1 }
  })
  assert.deepEqual(h.calls, [{ name: 'allowed', args: { value: 1 } }])
  h.readOnly()
  await assert.rejects(
    h.host.request(11, view.id, 'tools/call', { name: 'allowed' }),
    /unavailable/
  )
  h.revoke()
  assert.equal(h.host.document(view.id), null)
  await assert.rejects(h.host.request(11, view.id, 'tools/list', {}), /revoked/)
})
test('closing a renderer revokes its app capabilities', async () => {
  const h = fixture()
  const view = await h.host.open(11, h.connection)
  h.host.close(12, view.id)
  assert.ok(h.host.document(view.id))
  h.host.close(11)
  assert.equal(h.host.document(view.id), null)
})
test('closing an app during tool discovery prevents the pending tool call', async () => {
  const h = fixture()
  const view = await h.host.open(11, h.connection)
  const original = h.connection.listTools
  let finishDiscovery
  h.connection.listTools = () =>
    new Promise((resolve) => {
      finishDiscovery = resolve
    })
  const request = h.host.request(11, view.id, 'tools/call', { name: 'allowed' })
  h.host.close(11, view.id)
  finishDiscovery(await original())
  await assert.rejects(request, /revoked/)
  assert.deepEqual(h.calls, [])
})
