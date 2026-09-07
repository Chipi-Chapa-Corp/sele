/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function -- Isolated JavaScript runtime host stubs. */
// Exercise the installed Browser Use implementation against our private test browser.
// The runtime dependencies below are an isolated test host, not application configuration.
import assert from 'node:assert/strict'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

export async function checkInstalledBrowserRuntime({ runtimePath, socketPath, url, directory }) {
  const transportSockets = new Set()
  globalThis.nodeRepl = {
    cwd: directory,
    env: {
      BROWSER_USE_AVAILABLE_BACKENDS: 'iab',
      BROWSER_USE_CODEX_APP_BUILD_FLAVOR: 'prod',
      BROWSER_USE_TINYSKY_ENABLED: '1',
      BROWSER_USE_DISABLE_AMBIENT_NETWORK: '1',
      BROWSER_USE_SECURITY_MODE: 'disabled-for-local-testing'
    },
    requestMeta: {
      'x-codex-turn-metadata': {
        session_id: 'browser-test-session',
        turn_id: 'runtime-test-turn',
        thread_id: 'browser-test-session'
      }
    },
    config: {
      read: async () => ({ config: {} }),
      readRequirements: async () => ({}),
      readToml: async () => ({}),
      writeToml: async () => {}
    },
    nativePipe: {
      createConnection: async (target) => {
        if (target !== socketPath) throw new Error('Not the test browser')
        const socket = net.createConnection(target)
        await new Promise((resolve, reject) => {
          socket.once('connect', resolve)
          socket.once('error', reject)
        })
        transportSockets.add(socket)
        return socket
      }
    },
    setResponseMeta() {},
    addAfterSubmittedCodeHook() {},
    emitContentItem() {},
    createElicitation: async () => {
      throw new Error('Unexpected elicitation in isolated localhost test')
    },
    fetch: async () => {
      throw new Error('Unexpected network request from runtime test host')
    }
  }
  try {
    const { handleRpc } = await import(pathToFileURL(runtimePath).href)
    await handleRpc({ method: 'setup', params: { environment: 'codex-app' } })
    const execute = (type, params = {}) =>
      handleRpc({ method: 'execute', params: { type, ...params } })
    const browsers = await execute('list_browsers')
    assert.ok(browsers.some((browser) => browser.name === 'Sele' && browser.type === 'iab'))
    const browser = await execute('get_browser', { id: 'iab' })
    assert.equal(browser.apiSupportOverrides['Tab.ax'], true)
    await execute('get_browser_documentation', { browser_id: 'iab' })
    const tab = await execute('create_tab', { browser_id: 'iab' })
    await execute('navigate_tab_url', { browser_id: 'iab', tab_id: tab.id, url })
    const state = await execute('tab_ax_get_state', {
      browser_id: 'iab',
      tab_id: tab.id,
      content: 'axStateAndScreenshot'
    })

    assert.match(state.state, /Name/)
    assert.ok(state.data?.length > 100)
    const fieldIndex = Number(state.state.match(/(\d+) text field.*Name/)[1])
    await execute('tab_ax_action', {
      browser_id: 'iab',
      tab_id: tab.id,
      action: { kind: 'click', target: fieldIndex }
    })
    await execute('tab_ax_action', {
      browser_id: 'iab',
      tab_id: tab.id,
      action: { kind: 'type_text', text: 'Through cua runtime' }
    })
    const edited = await execute('tab_ax_get_state', {
      browser_id: 'iab',
      tab_id: tab.id,
      content: 'axState',
      disable_diffing: true
    })
    const buttonIndex = Number(edited.state.match(/(\d+) button Go/)[1])
    await execute('tab_ax_action', {
      browser_id: 'iab',
      tab_id: tab.id,
      action: { kind: 'click', target: buttonIndex }
    })
    const submitted = await execute('tab_ax_get_state', {
      browser_id: 'iab',
      tab_id: tab.id,
      content: 'axState',
      disable_diffing: true
    })
    assert.match(submitted.state, /text Through cua runtime/)
    await execute('browser_visibility_set', { browser_id: 'iab', visible: false })
    const hidden = await execute('tab_ax_get_state', {
      browser_id: 'iab',
      tab_id: tab.id,
      content: 'axStateAndScreenshot'
    })
    assert.ok(hidden.data?.length > 100)
    await execute('mark_tab', { browser_id: 'iab', tab_id: tab.id, status: 'handoff' })
    await execute('navigate_tab_url', { browser_id: 'iab', tab_id: tab.id, url: url + '/second' })
    await execute('navigate_tab_back', { browser_id: 'iab', tab_id: tab.id })
    await execute('navigate_tab_forward', { browser_id: 'iab', tab_id: tab.id })
    await execute('navigate_tab_reload', { browser_id: 'iab', tab_id: tab.id })
    await execute('close_tab', { browser_id: 'iab', tab_id: tab.id })
    console.log(
      'PASS: installed Browser Use runtime discovers Sele; accessibility clicks/typing, foreground/background screenshots, handoff, navigation/history/reload and closing work'
    )
  } finally {
    for (const socket of transportSockets) socket.destroy()
    delete globalThis.nodeRepl
  }
}
