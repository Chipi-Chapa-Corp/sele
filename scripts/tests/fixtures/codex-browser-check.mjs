import assert from 'node:assert/strict'

// Exercise direct Codex tools against the real BrowserPanel without a CLI or plugins.
export async function checkCodexBrowserTools({
  registerCodexBrowserTools,
  CodexDynamicTools,
  registerBrowserUseSession,
  removeBrowserUseSessions,
  window,
  url
}) {
  const registry = new CodexDynamicTools()
  const integration = registerCodexBrowserTools(registry)
  const owner = {}
  const threadId = 'browser-test-session'
  registry.bind(threadId, registry.specs)
  registerBrowserUseSession(owner, threadId, '', {
    kind: 'container',
    tool: 'distrobox',
    name: 'dev'
  })
  const call = async (tool, args = {}) => {
    const result = await registry.call({
      threadId,
      turnId: 'direct-browser-test',
      callId: tool,
      namespace: 'browser',
      tool,
      arguments: args
    })
    assert.equal(result.success, true, JSON.stringify(result))
    return result.contentItems[0].text
  }
  try {
    const context = JSON.parse(await call('tabs_context'))
    assert.ok(context.tabs.length > 0)
    const tab = JSON.parse(await call('tabs_create', { url, foreground: true }))
    assert.equal(tab.url, url + '/')
    assert.match(await call('get_page_text', { tabId: tab.id }), /Ready/)
    assert.match(await call('read_page', { tabId: tab.id }), /Name/)
    assert.equal(
      await window.webContents.executeJavaScript(
        'document.querySelector(".browser-panel").classList.contains("browser-panel--inactive")'
      ),
      false
    )
    registry.setReadOnly(threadId, true)
    assert.equal(
      (
        await registry.call({
          threadId,
          turnId: 'blocked',
          callId: 'blocked',
          namespace: 'browser',
          tool: 'tabs_create',
          arguments: {}
        })
      ).success,
      false
    )
    console.log(
      'PASS: direct Codex browser tools discover, open, show and read real tabs in a local container scope without Browser Use plugins'
    )
  } finally {
    integration.close()
    removeBrowserUseSessions(owner)
  }
}
