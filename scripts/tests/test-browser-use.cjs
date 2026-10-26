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
            "export {registerAppIpc} from './src/main/registerAppIpc';export {createClaudeBrowserIntegration} from './src/main/providers/claude/ClaudeBrowserTools';export {createBrowserMcpServer} from './src/main/browser/BrowserMcpServer';export {startBrowserAutomationService} from './src/main/browser/BrowserAutomation';export {startBrowserUseBridge} from './src/main/providers/codex/CodexBrowserBridge';export {registerBrowserUseSession, removeBrowserUseSessions} from './src/main/providers/codex/CodexBrowserSessions'",
          resolveDir: process.cwd(),
          loader: 'ts'
        },
        outfile: path.join(directory, 'bridge.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron', 'better-sqlite3', '@anthropic-ai/claude-agent-sdk']
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
      // Use X11 for deterministic native keyboard focus in the isolated Linux fixture.
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
  app.setPath('userData', path.join(process.argv[2], 'user-data'))
  app.setPath('logs', path.join(process.argv[2], 'logs'))
  const {
    registerAppIpc,
    createClaudeBrowserIntegration,
    createBrowserMcpServer,
    startBrowserAutomationService,
    startBrowserUseBridge,
    registerBrowserUseSession,
    removeBrowserUseSessions
  } = require(path.join(process.argv[2], 'bridge.cjs'))
  app.whenReady().then(async () => {
    let closeBridge, server, socket
    try {
      const downloads = path.join(process.argv[2], 'downloads')
      await fs.mkdir(downloads)
      app.setPath('downloads', downloads)
      const before = new Set(await fs.readdir('/tmp/codex-browser-use').catch(() => []))
      const browserService = startBrowserAutomationService()
      closeBridge = await startBrowserUseBridge(browserService)
      const codexOwner = {}
      registerBrowserUseSession(codexOwner, 'browser-test-session', '/work', null)
      const preferences = new Map()
      ipcMain.on('sele:preferences', (event, request) => {
        if (request.action === 'set') preferences.set(request.key, request.value)
        else if (request.action === 'remove') preferences.delete(request.key)
        event.returnValue = {
          ok: true,
          value: request.action === 'get' ? (preferences.get(request.key) ?? null) : null
        }
      })
      ipcMain.handle('sele:preferences', () => ({
        ok: true,
        value: Object.fromEntries(preferences)
      }))
      ipcMain.handle('browser:resolve-page-zoom-scale', () => 100)
      const externalLinks = []
      registerAppIpc()
      ipcMain.removeHandler('app:handle-external-link')
      ipcMain.handle('app:handle-external-link', (_event, options) => {
        externalLinks.push(options)
        return { action: 'open', always: false }
      })
      const window = new BrowserWindow({
        show: true,
        width: 900,
        height: 700,
        webPreferences: {
          backgroundThrottling: false,
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
      let promptSelection
      const assertPromptFocus = async (action) => {
        await window.webContents.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        assert.equal(
          await window.webContents.executeJavaScript('document.activeElement.id'),
          'prompt',
          `prompt retains focus after ${action}`
        )
        assert.equal(
          window.webContents.isFocused(),
          true,
          `host keeps keyboard focus after ${action}`
        )
        if (promptSelection) {
          assert.deepEqual(
            await window.webContents.executeJavaScript(
              '(() => { const prompt = document.querySelector("#prompt"); return [prompt.selectionStart, prompt.selectionEnd] })()'
            ),
            promptSelection,
            `prompt selection survives ${action}`
          )
        }
      }
      assert.equal((await rpc('getTabs')).length, 1)
      await assertPromptFocus('lazy browser mount')
      const tab = await rpc('createTab')
      assert.ok(tab.id > 0)
      await assertPromptFocus('agent tab creation')
      const cdp = (method, commandParams = {}) =>
        rpc('executeCdp', { target: { tabId: tab.id }, method, commandParams })
      await rpc('attach', { tabId: tab.id })
      await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
      await cdp('Page.enable')
      server = http.createServer((req, res) => {
        if (req.url === '/download-redirect') {
          res.writeHead(302, { Location: '/download-fixture' }).end()
          return
        }
        if (req.url === '/download-fixture') {
          res.setHeader('Content-Type', 'text/plain')
          res.setHeader('Content-Disposition', 'attachment; filename="fixture.txt"')
          res.end('Sele browser download fixture\n')
          return
        }
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
      await assertPromptFocus('agent navigation')
      const hostButton = await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[aria-label="Open in host browser"]')
        if (!button || button.disabled) throw new Error('Host browser button is not enabled')
        const rect = button.getBoundingClientRect()
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
      })()`)
      window.webContents.sendInputEvent({
        type: 'mouseDown',
        ...hostButton,
        button: 'left',
        clickCount: 1
      })
      window.webContents.sendInputEvent({
        type: 'mouseUp',
        ...hostButton,
        button: 'left',
        clickCount: 1
      })
      for (let i = 0; i < 50 && externalLinks.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      assert.deepEqual(externalLinks, [{ url: url + '/', action: 'open' }])
      await window.webContents.executeJavaScript(
        'document.querySelector("#prompt").focus(); document.querySelector("#prompt").setSelectionRange(2, 5)'
      )
      promptSelection = [2, 5]
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
      await assertPromptFocus('agent click')
      await cdp('Input.insertText', { text: 'From browser use' })
      await assertPromptFocus('agent typing')
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
      await assertPromptFocus('agent screenshot')
      await cdp('Runtime.evaluate', { expression: 'document.querySelector("#name").focus()' })
      await assertPromptFocus('agent JavaScript focus')
      const background = await rpc('createTab')
      await assertPromptFocus('second tab creation')
      await rpc('executeCdp', {
        target: { tabId: background.id },
        method: 'Page.bringToFront'
      })
      await assertPromptFocus('agent tab activation')
      await rpc('executeCdp', { target: { tabId: background.id }, method: 'Page.close' })
      await assertPromptFocus('agent tab closure')
      for (const visible of [false, true]) {
        await rpc('executeUnhandledCommand', { type: 'browser_visibility_set', visible })
        if (!visible) {
          await cdp('Input.insertText', { text: ' hidden' })
          assert.equal(
            (
              await cdp('Runtime.evaluate', {
                expression: 'document.querySelector("#name").value',
                returnByValue: true
              })
            ).result.value,
            'From browser use hidden',
            'agent can type into a hidden browser without editing the prompt'
          )
        }
        await assertPromptFocus(`agent visibility change (${visible})`)
      }
      await assert.rejects(cdp('Input.unsupportedFocusTest'), /./)
      await assertPromptFocus('failed agent command')
      await Promise.all([
        cdp('Input.insertText', { text: ' A' }),
        cdp('Input.insertText', { text: ' B' })
      ])
      assert.match(
        (
          await cdp('Runtime.evaluate', {
            expression: 'document.querySelector("#name").value',
            returnByValue: true
          })
        ).result.value,
        /^From browser use hidden (A B|B A)$/
      )
      await assertPromptFocus('concurrent agent input')
      assert.equal(
        await window.webContents.executeJavaScript('document.querySelector("#prompt").value'),
        'Draft prompt',
        'browser typing never changes the prompt draft'
      )
      window.webContents.sendInputEvent({ type: 'char', keyCode: '!' })
      promptSelection = undefined
      await assertPromptFocus('user typing after browser actions')
      assert.equal(
        await window.webContents.executeJavaScript('document.querySelector("#prompt").value'),
        'Dr! prompt'
      )
      console.log(
        'PASS: prompt focus, selection and user typing survive browser tabs, visible/hidden input, concurrent commands and failures'
      )
      assert.ok(events.some((event) => event.method === 'onCDPEvent'))
      await assert.rejects(cdp('Browser.close'), /Unsupported/)
      for (const target of [
        { tabId: tab.id, sessionId: 'unowned' },
        { tabId: tab.id, targetId: 'unowned' }
      ]) {
        await assert.rejects(
          rpc('executeCdp', {
            target,
            method: 'Runtime.evaluate',
            commandParams: { expression: '1' }
          }),
          /outside|unknown|not owned/i
        )
      }
      await assert.rejects(
        cdp('Target.attachToTarget', { targetId: 'unowned', flatten: true }),
        /outside|unknown|not owned/i
      )
      await assert.rejects(
        cdp('DOM.setFileInputFiles', { files: ['relative-upload.txt'] }),
        /absolute/i
      )
      await assert.rejects(
        rpc('executeCdp', {
          target: { tabId: window.webContents.id },
          method: 'Runtime.evaluate',
          commandParams: { expression: '1' }
        }),
        /outside/
      )
      await assert.rejects(cdp('Page.navigate', { url: 'javascript:alert(1)' }), /Unsupported/)
      const target = (await cdp('Target.getTargets')).targetInfos[0]
      await cdp('Target.closeTarget', { targetId: target.targetId })
      assert.equal((await rpc('getTabs')).length, 1)
      const { checkClaudeBrowserTools, checkInstalledClaudeBrowserSdk } = await import(
        './fixtures/claude-browser-check.mjs'
      )
      await checkClaudeBrowserTools({
        createClaudeBrowserIntegration,
        browserService,
        window,
        url,
        codexTabId: (await rpc('getTabs'))[0].id
      })
      const { checkBrowserMcp } = await import('./fixtures/browser-mcp-check.mjs')
      await checkBrowserMcp({ createBrowserMcpServer, browserService, window, url })
      if (process.env.SELE_COPILOT_RUNTIME) {
        const { checkInstalledCopilotBrowser } = await import(
          './fixtures/copilot-browser-check.mjs'
        )
        await checkInstalledCopilotBrowser({
          createBrowserMcpServer,
          browserService,
          runtimePath: process.env.SELE_COPILOT_RUNTIME,
          directory: process.argv[2],
          url
        })
      }
      if (process.env.SELE_CLAUDE_RUNTIME) {
        await checkInstalledClaudeBrowserSdk({
          createClaudeBrowserIntegration,
          browserService,
          runtimePath: process.env.SELE_CLAUDE_RUNTIME,
          directory: process.argv[2]
        })
      }
      if (process.env.SELE_BROWSER_RUNTIME) {
        const { checkInstalledBrowserRuntime } = await import(
          './fixtures/browser-runtime-check.mjs'
        )
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
      const run = (source) => window.webContents.executeJavaScript(source)
      const waitForSession = async (predicate) => {
        const deadline = Date.now() + 8000
        while (Date.now() < deadline) {
          const stored = await run(`window.preferencesApi.getItem('sele:browser-tabs:v2').value`)
          const session = JSON.parse(stored || '{}')['tab-reuse']
          if (session && predicate(session)) return session
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        assert.fail('Timed out waiting for browser tab reuse')
      }
      await run(`window.browserTabReuseFixture.active(true);
        window.browserTabReuseFixture.workspace('tab-reuse')`)
      const emptySession = await waitForSession((session) => session.tabs.length === 1)
      const emptyId = emptySession.tabs[0].id
      await run(`window.browserTabReuseFixture.open(${JSON.stringify(url + '/reuse-first')})`)
      await waitForSession((session) => session.tabs[0]?.url === url + '/reuse-first')
      const reused = await waitForSession((session) => session.tabs.length === 1)
      assert.equal(reused.activeTabId, emptyId, 'Opening a URL reuses an empty tab')
      await run(`window.browserTabReuseFixture.open(${JSON.stringify(url + '/reuse-second')})`)
      await waitForSession((session) => session.tabs.length === 2)
      await run(`document.querySelector('[aria-label="New browser tab"]').click()`)
      const withBlank = await waitForSession((session) => session.tabs.length === 3)
      const blankId = withBlank.activeTabId
      await run(`document.querySelector('[aria-label="Browser tabs"] [aria-pressed]').click()`)
      await run(`window.browserTabReuseFixture.open(${JSON.stringify(url + '/reuse-background')})`)
      const backgroundReused = await waitForSession((session) =>
        session.tabs.some((tab) => tab.url === url + '/reuse-background')
      )
      assert.equal(backgroundReused.tabs.length, 3)
      assert.equal(backgroundReused.activeTabId, blankId, 'Reuses an inactive blank tab')
      await run(`document.querySelector('[aria-label="New browser tab"]').click()`)
      const beforeRemount = await waitForSession((session) => session.tabs.length === 4)
      await run(`window.browserTabReuseFixture.mount(false)`)
      await run(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
      )
      assert.equal(await run(`document.querySelector('.browser-panel') === null`), true)
      await run(`window.browserTabReuseFixture.open(${JSON.stringify(url + '/reuse-restored')})`)
      const restored = await waitForSession((session) =>
        session.tabs.some((tab) => tab.url === url + '/reuse-restored')
      )
      assert.equal(restored.tabs.length, 4)
      assert.equal(restored.activeTabId, beforeRemount.activeTabId, 'Reuses a restored blank tab')
      console.log('PASS: browser URL requests reuse active, inactive and restored blank tabs')
      const localPath = path.join(process.argv[2], 'local page #1.html')
      await fs.writeFile(path.join(process.argv[2], 'local.css'), 'body { color: rgb(12, 34, 56) }')
      await fs.writeFile(
        localPath,
        '<!doctype html><title>Local browser file</title><link rel="stylesheet" href="local.css"><h1>Local page</h1><script>document.body.dataset.ready="yes"</script>'
      )
      const localUrl = require('node:url').pathToFileURL(localPath).href
      await run(`window.appApi.openFileInBrowser({path:${JSON.stringify(localPath)}})`)
      await waitForSession((session) => session.tabs.some((tab) => tab.url === localUrl))
      const waitForLocalPage = () =>
        run(`new Promise((resolve,reject)=>{
        const end=Date.now()+8000;
        async function check(){
          const view=[...document.querySelectorAll('webview')].find(view=>view.getAttribute('src')===${JSON.stringify(localUrl)});
          try {
            if(view && await view.executeJavaScript('document.body.dataset.ready==="yes" && getComputedStyle(document.body).color==="rgb(12, 34, 56)"')) return resolve(true);
          } catch {}
          if(Date.now()>end)return reject(new Error('Local page failed to load'));
          setTimeout(check,30);
        }check();
      })`)
      await waitForLocalPage()
      await run('window.browserTabReuseFixture.mount(false)')
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await run('window.browserTabReuseFixture.mount(true)')
      await waitForLocalPage()
      console.log(
        'PASS: file:/// pages load scripts and relative styles and survive browser restoration'
      )
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
