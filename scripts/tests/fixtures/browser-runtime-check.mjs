// Exercise the installed Browser Use implementation against our private test browser.
// The runtime dependencies below are an isolated test host, not application configuration.
import assert from 'node:assert/strict'
import net from 'node:net'
import http from 'node:http'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkInstalledBrowserRuntime({ runtimePath, socketPath, url, directory }) {
  const transportSockets = new Set()
  const artifactServer = http.createServer((request, response) => {
    if (request.url === '/download') {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="runtime-test.txt"'
      })
      response.end('Downloaded through native Browser Use')
    } else if (request.url === '/frame') {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><label>Frame field<input id="frame-input"></label><button onclick="document.querySelector(\'#frame-result\').textContent=\'Frame clicked\'">Frame action</button><p id="frame-result"></p>'
      )
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        `<!doctype html><input type="file" id="upload" multiple onchange="document.querySelector('#upload-result').textContent=Array.from(this.files,f=>f.name).join(',')"><p id="upload-result"></p><a href="/download" download>Download test file</a><iframe src="http://localhost:${artifactServer.address().port}/frame"></iframe>`
      )
    }
  })
  await new Promise((resolve) => artifactServer.listen(0, '127.0.0.1', resolve))
  const artifactUrl = `http://127.0.0.1:${artifactServer.address().port}`
  const uploadPath = join(directory, 'runtime-upload.txt')
  const uploadPath2 = join(directory, 'runtime-upload-2.txt')
  await Promise.all([
    writeFile(uploadPath, 'Runtime upload one'),
    writeFile(uploadPath2, 'Runtime upload two')
  ])
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
    await execute('navigate_tab_url', { browser_id: 'iab', tab_id: tab.id, url: artifactUrl })
    await execute('playwright_wait_for_load_state', {
      browser_id: 'iab',
      tab_id: tab.id,
      state: 'load'
    })
    const chooserPromise = execute('playwright_wait_for_file_chooser', {
      browser_id: 'iab',
      tab_id: tab.id,
      timeout_ms: 10000
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await execute('playwright_locator_click', {
      browser_id: 'iab',
      tab_id: tab.id,
      selector: '#upload'
    })
    const chooser = await chooserPromise
    assert.equal(chooser.is_multiple, true)
    await execute('playwright_file_chooser_set_files', {
      browser_id: 'iab',
      tab_id: tab.id,
      file_chooser_id: chooser.file_chooser_id,
      files: [uploadPath, uploadPath2]
    })
    const fileNames = await execute('playwright_locator_inner_text', {
      browser_id: 'iab',
      tab_id: tab.id,
      selector: '#upload-result'
    })
    assert.match(JSON.stringify(fileNames), /runtime-upload-2.txt/)
    const downloadPromise = execute('playwright_wait_for_download', {
      browser_id: 'iab',
      tab_id: tab.id,
      timeout_ms: 10000
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await execute('playwright_locator_click', { browser_id: 'iab', tab_id: tab.id, selector: 'a' })
    const download = await downloadPromise
    const saved = await execute('playwright_download_path', {
      browser_id: 'iab',
      tab_id: tab.id,
      download_id: download.download_id
    })
    assert.equal(await readFile(saved.path, 'utf8'), 'Downloaded through native Browser Use')
    await unlink(saved.path)
    const frame = await execute('playwright_locator_inner_text', {
      browser_id: 'iab',
      tab_id: tab.id,
      selector: 'iframe >> internal:control=enter-frame >> body'
    })
    assert.match(JSON.stringify(frame), /Frame action/)
    await execute('playwright_locator_click', {
      browser_id: 'iab',
      tab_id: tab.id,
      selector: 'iframe >> internal:control=enter-frame >> button'
    })
    const frameResult = await execute('playwright_locator_inner_text', {
      browser_id: 'iab',
      tab_id: tab.id,
      selector: 'iframe >> internal:control=enter-frame >> #frame-result'
    })
    assert.match(JSON.stringify(frameResult), /Frame clicked/)
    await execute('close_tab', { browser_id: 'iab', tab_id: tab.id })
    console.log(
      'PASS: installed Browser Use runtime discovers Sele; accessibility input, screenshots, handoff, history, multiple file uploads, native downloads and cross-origin frame interaction work'
    )
  } finally {
    for (const socket of transportSockets) socket.destroy()
    delete globalThis.nodeRepl
    await new Promise((resolve) => artifactServer.close(resolve))
  }
}
