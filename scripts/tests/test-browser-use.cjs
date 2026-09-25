const fs = require('node:fs/promises')
const path = require('node:path')
if (!process.versions.electron) {
  const { build } = require('esbuild')
  const { spawnSync } = require('node:child_process')
  ;(async () => {
    const directory = await fs.mkdtemp('/tmp/sele-browser-use-test-')
    try {
      await fs.symlink(
        path.join(process.cwd(), 'node_modules'),
        path.join(directory, 'node_modules'),
        'dir'
      )
      // Use one bundle so the bridge and session registration share the same registry.
      await build({
        stdin: {
          contents:
            "export {createClaudeBrowserIntegration} from './src/main/providers/claude/ClaudeBrowserTools';export {startBrowserAutomationService} from './src/main/browser/BrowserAutomation';export {startBrowserUseBridge} from './src/main/providers/codex/CodexBrowserBridge';export {registerBrowserUseSession, removeBrowserUseSessions} from './src/main/providers/codex/CodexBrowserSessions'",
          resolveDir: process.cwd(),
          loader: 'ts'
        },
        outfile: path.join(directory, 'bridge.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron', '@anthropic-ai/claude-agent-sdk']
      })
      await build({
        entryPoints: ['src/preload/index.ts'],
        outfile: path.join(directory, 'preload.cjs'),
        bundle: true,
        platform: 'node',
        external: ['electron']
      })
      await build({
        entryPoints: ['scripts/tests/fixtures/browser-use.tsx'],
        outfile: path.join(directory, 'fixture.js'),
        bundle: true,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' }
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>'
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      // Electron offscreen input on Wayland is unreliable; use XWayland for this fixture.
      const displayArgs =
        process.platform === 'linux' && environment.DISPLAY ? ['--ozone-platform=x11'] : []
      const result = spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox', ...displayArgs],
        {
          env: environment,
          stdio: 'inherit',
          timeout: 60000,
          killSignal: 'SIGKILL'
        }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) {
        if (result.error) process.stderr.write(String(result.error))
        process.exitCode = 1
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  const net = require('node:net')
  const http = require('node:http')
  const assert = require('node:assert/strict')
  const {
    createClaudeBrowserIntegration,
    startBrowserAutomationService,
    startBrowserUseBridge,
    registerBrowserUseSession,
    removeBrowserUseSessions
  } = require(path.join(process.argv[2], 'bridge.cjs'))
  app.setPath('userData', path.join(process.argv[2], 'user-data'))
  app.whenReady().then(async () => {
    let closeBridge, server, socket
    try {
      const before = new Set(await fs.readdir('/tmp/codex-browser-use').catch(() => []))
      const browserService = startBrowserAutomationService()
      closeBridge = await startBrowserUseBridge(browserService)
      const codexOwner = {}
      registerBrowserUseSession(codexOwner, 'browser-test-session', '/work', null)
      ipcMain.handle('browser:resolve-page-zoom-scale', () => 100)
      const window = new BrowserWindow({
        show: false,
        width: 900,
        height: 700,
        webPreferences: {
          offscreen: true,
          webviewTag: true,
          preload: path.join(process.argv[2], 'preload.cjs'),
          contextIsolation: true,
          sandbox: true
        }
      })
      window.webContents.on('will-attach-webview', (_event, preferences) => {
        preferences.backgroundThrottling = false
      })
      await window.loadFile(path.join(process.argv[2], 'index.html'))
      await new Promise((resolve) => setTimeout(resolve, 200))
      const name = (await fs.readdir('/tmp/codex-browser-use')).find((name) => !before.has(name))
      socket = net.createConnection(path.join('/tmp/codex-browser-use', name))
      await new Promise((resolve) => socket.once('connect', resolve))
      let buffer = Buffer.alloc(0),
        next = 0
      const pending = new Map(),
        events = []
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        while (buffer.length >= 4) {
          const length = buffer.readUInt32LE()
          if (buffer.length < length + 4) return
          const response = JSON.parse(buffer.subarray(4, 4 + length))
          buffer = buffer.subarray(4 + length)
          if (response.id !== undefined) {
            const task = pending.get(response.id)
            pending.delete(response.id)
            response.error
              ? task.reject(new Error(response.error.message))
              : task.resolve(response.result)
          } else events.push(response)
        }
      })
      const rpc = (method, params = {}) =>
        new Promise((resolve, reject) => {
          const id = ++next
          const timer = setTimeout(() => reject(new Error('Timed out: ' + method)), 15000)
          pending.set(id, {
            resolve: (value) => {
              clearTimeout(timer)
              resolve(value)
            },
            reject: (error) => {
              clearTimeout(timer)
              reject(error)
            }
          })
          const body = Buffer.from(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              method,
              params: { session_id: 'browser-test-session', turn_id: 'test-turn', ...params }
            })
          )
          const header = Buffer.alloc(4)
          header.writeUInt32LE(body.length)
          socket.write(Buffer.concat([header, body]))
        })
      const info = await rpc('getInfo')
      assert.equal(info.type, 'iab')
      assert.equal(info.metadata.codexSessionId, 'browser-test-session')
      await assert.rejects(rpc('getInfo', { session_id: 'unrelated-session' }), /not owned/)
      assert.equal((await rpc('getTabs')).length, 1)
      const tab = await rpc('createTab')
      assert.ok(tab.id > 0)
      // Let BrowserPanel finish its animation-frame focus when lazily mounted.
      await window.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      const cdp = (method, commandParams = {}) =>
        rpc('executeCdp', { target: { tabId: tab.id }, method, commandParams })
      await rpc('attach', { tabId: tab.id })
      await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
      await cdp('Page.enable')
      server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(
          '<!doctype html><title>Sele browser test</title><label>Name <input id="name"></label><button id="go" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Go</button><p id="result">Ready</p>'
        )
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const url = `http://127.0.0.1:${server.address().port}`
      await cdp('Page.navigate', { url })
      for (let i = 0; i < 100; i++) {
        const value = await cdp('Runtime.evaluate', {
          expression: 'document.readyState === "complete" && !!document.querySelector("#name")',
          returnByValue: true
        })
        if (value.result.value) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      await cdp('Runtime.evaluate', {
        expression:
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        awaitPromise: true
      })
      const click = async (selector) => {
        const box = await cdp('Runtime.evaluate', {
          expression: `(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`,
          returnByValue: true
        })
        for (const type of ['mousePressed', 'mouseReleased'])
          await cdp('Input.dispatchMouseEvent', {
            type,
            ...box.result.value,
            button: 'left',
            clickCount: 1
          })
      }
      await click('#name')
      await cdp('Input.insertText', { text: 'From browser use' })
      await click('#go')
      assert.equal(
        (
          await cdp('Runtime.evaluate', {
            expression: 'document.querySelector("#result").textContent',
            returnByValue: true
          })
        ).result.value,
        'From browser use'
      )
      const shot = await cdp('Page.captureScreenshot', { format: 'png' })
      assert.ok(Buffer.from(shot.data, 'base64').length > 1000)
      assert.ok(events.some((event) => event.method === 'onCDPEvent'))
      await assert.rejects(cdp('Browser.close'), /Unsupported/)
      await assert.rejects(
        rpc('executeCdp', {
          target: { tabId: window.webContents.id },
          method: 'Runtime.evaluate',
          commandParams: { expression: '1' }
        }),
        /outside/
      )
      await assert.rejects(cdp('Page.navigate', { url: 'file:///etc/passwd' }), /Unsupported/)
      const target = (await cdp('Target.getTargets')).targetInfos[0]
      await cdp('Target.closeTarget', { targetId: target.targetId })
      assert.equal((await rpc('getTabs')).length, 1)
      const { checkClaudeBrowserTools, checkInstalledClaudeBrowserSdk } =
        await import('./fixtures/claude-browser-check.mjs')
      await checkClaudeBrowserTools({
        createClaudeBrowserIntegration,
        browserService,
        window,
        url,
        codexTabId: (await rpc('getTabs'))[0].id
      })
      if (process.env.SELE_CLAUDE_RUNTIME) {
        await checkInstalledClaudeBrowserSdk({
          createClaudeBrowserIntegration,
          browserService,
          runtimePath: process.env.SELE_CLAUDE_RUNTIME,
          directory: process.argv[2]
        })
      }
      if (process.env.SELE_BROWSER_RUNTIME) {
        const { checkInstalledBrowserRuntime } =
          await import('./fixtures/browser-runtime-check.mjs')
        await checkInstalledBrowserRuntime({
          runtimePath: process.env.SELE_BROWSER_RUNTIME,
          socketPath: path.join('/tmp/codex-browser-use', name),
          url,
          directory: process.argv[2]
        })
      }
      const remainingTab = (await rpc('getTabs'))[0]
      await rpc('attach', { tabId: remainingTab.id })
      removeBrowserUseSessions(codexOwner)
      await assert.rejects(rpc('getInfo'), /not owned/)
      const replacement = browserService.createClient({
        providerId: 'codex',
        sessionId: 'browser-test-session',
        cwd: '/work',
        containerKey: 'host'
      })
      await replacement.attach(remainingTab.id)
      replacement.close()
      console.log(
        'PASS: native Browser Use discovery, real BrowserPanel tabs, CDP events, navigation, typing, clicking, screenshots, closing and session/tab isolation'
      )
      socket.end()
      await closeBridge()
      await new Promise((resolve) => server.close(resolve))
      app.exit(0)
    } catch (error) {
      console.error(error)
      socket?.destroy()
      await closeBridge?.()
      server?.close()
      app.exit(1)
    }
  })
}
