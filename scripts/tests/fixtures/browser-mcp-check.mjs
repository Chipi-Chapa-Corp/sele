import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// Exercise provider-neutral HTTP MCP against the real scoped BrowserPanel, without model calls.
export async function checkBrowserMcp({ createBrowserMcpServer, browserService, window, url }) {
  const integrations = []
  const clients = []
  try {
    const handles = []
    for (const providerId of ['copilot', 'opencode']) {
      const scope = {
        providerId,
        sessionId: 'browser-test-session',
        cwd: '/work',
        containerKey: 'host'
      }
      const integration = await createBrowserMcpServer(browserService, scope, {
        requireSessionMetadata: providerId === 'opencode'
      })
      integrations.push(integration)
      assert.equal((await fetch(integration.url, { method: 'POST' })).status, 403)
      const client = new Client({ name: `sele-${providerId}-test`, version: '1.0.0' })
      clients.push(client)
      await client.connect(
        new StreamableHTTPClientTransport(new URL(integration.url), {
          requestInit: { headers: { Authorization: `Bearer ${integration.token}` } }
        })
      )
      const metadata = providerId === 'opencode' ? { 'ai.opencode/sessionID': scope.sessionId } : {}
      const call = (name, args = {}, meta = metadata) =>
        client.callTool({ name, arguments: args, _meta: meta })
      const value = async (name, args) => {
        const result = await call(name, args)
        assert.ok(!result.isError, `${providerId}/${name}: ${JSON.stringify(result)}`)
        const text = result.content.find((item) => item.type === 'text')?.text
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
      const tools = (await client.listTools()).tools
      assert.ok(tools.some((tool) => tool.name === 'tabs_context'))
      assert.deepEqual((await value('tabs_context')).tabs, [])
      if (providerId === 'opencode') {
        for (const meta of [{}, { 'ai.opencode/sessionID': 'another-session' }]) {
          const rejected = await call('tabs_create', {}, meta)
          assert.equal(rejected.isError, true)
          assert.match(rejected.content[0].text, /session mismatch/)
        }
      }
      const tab = await value('navigate', { url })
      const tree = await value('read_page', { tabId: tab.id })
      const ref = tree.match(/\[(ref_\d+)\] textbox/)[1]
      await value('form_input', { tabId: tab.id, ref, value: `From ${providerId}` })
      const entered = await value('javascript_tool', {
        action: 'javascript_exec',
        tabId: tab.id,
        text: 'document.querySelector("#name").value'
      })
      assert.equal(entered, `From ${providerId}`)
      const screenshot = await call('computer', { tabId: tab.id, action: 'screenshot' })
      assert.ok(screenshot.content.some((item) => item.type === 'image' && item.data.length > 100))
      handles.push({ providerId, integration, call, value, tab })
    }
    for (const handle of handles) {
      const foreign = handles.find((other) => other !== handle).tab
      const rejected = await handle.call('javascript_tool', {
        action: 'javascript_exec',
        text: '1',
        tabId: foreign.id
      })
      assert.equal(rejected.isError, true)
      assert.match(rejected.content[0].text, /outside/)
      handle.integration.suspend()
      assert.equal((await handle.call('tabs_context')).isError, true)
      handle.integration.resume()
      assert.ok((await handle.value('tabs_context')).tabs.some((tab) => tab.id === handle.tab.id))
    }
    await window.webContents.executeJavaScript('window.browserTestDisabled = true')
    for (const handle of handles) {
      const rejected = await handle.call('tabs_create')
      assert.equal(rejected.isError, true)
      assert.match(rejected.content[0].text, /disabled/)
    }
    console.log(
      'PASS: Copilot/OpenCode HTTP MCP drives real tabs, forms and screenshots; bearer/caller/provider isolation, suspension and disabled settings enforced'
    )
  } finally {
    await window.webContents.executeJavaScript('window.browserTestDisabled = false')
    await Promise.allSettled(clients.map((client) => client.close()))
    await Promise.allSettled(integrations.map((integration) => integration.close()))
  }
}
