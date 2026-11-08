const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    await fs.mkdir(path.resolve('tmp'), { recursive: true })
    const directory = await fs.mkdtemp(path.resolve('tmp/local-access-'))
    let vite
    let viteCache
    try {
      await fs.mkdir(path.join(directory, 'main'))
      await fs.symlink(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir')
      await require('esbuild').build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'ts',
          contents: `
          export * from './src/main/registerLocalAccess'
          export * from './src/main/clientIpc'
          export {handleClientRequest} from './src/main/logging'
          export {createChatSleepState} from './src/main/chatSleepState'
          export {registerProviderIpc} from './src/main/providers/registerProviderIpc'
          export {appIpcChannels} from './src/shared/app'
          export {providerIpcChannels} from './src/shared/provider'
          export {terminalIpcChannels} from './src/shared/terminal'
          export {localAccessChannels} from './src/shared/localAccess'
        `
        },
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: path.join(directory, 'main/fixture.cjs'),
        external: ['electron', 'ws'],
        plugins: [
          {
            name: 'fixture-provider-service',
            setup(build) {
              build.onLoad({ filter: /\/providers\/providerService\.ts$/ }, () => ({
                loader: 'ts',
                contents: `
              const fixture = globalThis.lanFixture
              export const providerApi = new Proxy({}, {get: (_, name) => {
                if (name === 'onChatUpdated') return listener => {fixture.publish=listener; return ()=>{}}
                return (...args) => {
                  if (!fixture.operations[name]) throw new Error('Unexpected provider operation: '+name)
                  return fixture.operations[name](...args)
                }
              }})
              export const startLimitResetQueue = () => {}
              export const getProviderKnownChats = async () => fixture.page()
              export const getProviderCachedChat = async () => fixture.detail()
              export const getProviderConversationViews = async () => [fixture.detail()]
              export const getProviderChatWindow = async () => fixture.detail()
              export const getProviderChatCursorWindow = async () => fixture.detail()
              export const getProviderChatItemWindow = async () => fixture.detail()
              export const getProviderSubagentItemWindow = async () => fixture.detail()
              export const beginProviderConversationRead = async () => null
              export const beginProviderChatHistoryRead = async () => null
              export const saveProviderConversationView = async () => {}
              export const saveProviderChatHistory = async () => {}
              export const getChatUpdateSummary = detail => fixture.summary(detail)
            `
              }))
            }
          }
        ]
      })
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      if (process.argv.includes('--dev')) {
        viteCache = await fs.mkdtemp(path.resolve('node_modules/.sele-lan-test-'))
        const { createServer, loadConfigFromFile } = await import('vite')
        const config = await loadConfigFromFile(
          { command: 'serve', mode: 'development' },
          path.resolve('electron.vite.config.ts')
        )
        vite = await createServer({
          ...config.config.renderer,
          configFile: false,
          cacheDir: viteCache,
          root: path.resolve('src/renderer'),
          server: { host: '127.0.0.1', port: 0 }
        })
        await vite.listen()
        env.ELECTRON_RENDERER_URL = `http://127.0.0.1:${vite.httpServer.address().port}`
      }
      for (const extra of [[], ['--restore']]) {
        await new Promise((resolve, reject) => {
          const child = require('node:child_process').spawn(
            require('electron'),
            [__filename, directory, '--no-sandbox', '--ozone-platform=x11', ...extra],
            { env, timeout: env.SELE_ANDROID_TEST_SERIAL ? 240000 : 100000 }
          )
          let stderr = ''
          let stdout = ''
          child.stdout.on('data', (data) => {
            stdout += data
            process.stdout.write(data)
          })
          child.stderr.on('data', (data) => {
            stderr += data
          })
          child.on('error', reject)
          child.on('close', (code) => {
            const marker = extra.includes('--restore')
              ? 'LOCAL ACCESS RESTART PASSED'
              : env.SELE_TEST_MOBILE_WEB
                ? 'ANDROID WEB BUNDLE PASSED'
                : env.SELE_ANDROID_TEST_SERIAL
                  ? 'ANDROID APK PASSED'
                  : 'LOCAL ACCESS UI PASSED'
            if (code === 0 && stdout.includes(marker)) resolve()
            else reject(new Error(stderr || `Fixture exited before completing: ${marker}`))
          })
        })
      }
    } finally {
      await vite?.close()
      if (viteCache) await fs.rm(viteCache, { recursive: true, force: true })
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, ipcMain } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.commandLine.appendSwitch('force-prefers-reduced-motion')
  app.on('window-all-closed', () => {})
  const handlers = new Map()
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) => {
    handlers.set(channel, handler)
    handle(channel, handler)
  }
  let host
  let window
  let second
  let exitCode = 0
  app
    .whenReady()
    .then(async () => {
      const now = Date.now()
      const chat = {
        id: 'lan-fixture',
        providerId: 'codex',
        createdAt: now,
        updatedAt: now,
        title: 'LAN fixture conversation',
        preview: 'Saved LAN answer',
        cwd: '/fixture',
        cwdKind: 'directory',
        projectCwd: null,
        branchName: null,
        worktreeBaseBranchName: null,
        container: null,
        status: process.env.SELE_ANDROID_POLISH_ONLY ? 'active' : null,
        pinned: false,
        sidebarOrder: null,
        done: false,
        seenUpdatedAt: now,
        purpose: null,
        lastTurnOutcome: null,
        pendingApproval: null
      }
      let revision = 1
      let items = [
        { type: 'message', id: 'initial-user', role: 'user', content: 'A saved question' },
        { type: 'message', id: 'initial-answer', role: 'assistant', content: 'Saved LAN answer' }
      ]
      if (process.env.SELE_ANDROID_POLISH_ONLY) items.push({
        type: 'working', id: 'polish-working', status: 'working', startedAt: now - 65000,
        items: [], tokenUsage: {inputTokens: 100, cachedInputTokens: 0, outputTokens: 200,
          cost: {input: .02, cachedInput: 0, output: .1, total: .12}}
      })
      const detail = () => ({
        ...chat,
        revision,
        items,
        writeAccess: 'writable',
        capabilities: { editMessages: true, activeMessages: true, setGoal: true },
        pendingApproval: null,
        pendingUserInput: null,
        contextUsage: null,
        subagents: [],
        turnCount: 1,
        itemsStartTurnIndex: 0
      })
      const summary = (value) => ({
        ...chat,
        revision: value.revision,
        preview: value.items.at(-1)?.content ?? '',
        status: value.status
      })
      const usage = {
        updatedAt: now,
        statisticsLoaded: false,
        summary: null,
        dailyUsageBuckets: null,
        rateLimits: [],
        rateLimitResetCredits: null,
        errors: []
      }
      const operations = {
        getChats: () => ({ chats: [chat], nextCursor: null }),
        getChat: detail,
        getAccounts: () => ({
          available: true,
          unavailableMessage: null,
          accounts: [{ id: 'default', displayName: 'Fixture account', active: true }]
        }),
        getModels: () => [
          {
            id: 'fixture',
            label: process.env.SELE_MOBILE_LONG_MODEL_LABEL ? 'GPT-6.1 Extended reasoning with a long mobile preset name' : 'Fixture model',
            isDefault: true,
            supportedReasoningEfforts: [],
            defaultReasoningEffort: 'medium'
          }
        ],
        getUsage: () => usage,
        getUpdateAvailability: () => null,
        markChatSeen: () => chat,
        continueChat: (_provider, _chat, message) => {
          assert.equal(message, 'Hello from the phone')
          globalThis.lanFixture.sends++
          items = [
            ...items,
            { type: 'message', id: 'phone-user', role: 'user', content: message },
            {
              type: 'message',
              id: 'phone-answer',
              role: 'assistant',
              content: 'Live answer over the LAN'
            }
          ]
          revision++
          const value = detail()
          globalThis.lanFixture.publish({
            providerId: 'codex',
            chatId: chat.id,
            detail: value,
            summary: summary(value),
            turnCompleted: true,
            conversationKnown: true
          })
          return value
        }
      }
      for (const name of [
        'getChatContainers',
        'getAgentModes',
        'getApprovalModes',
        'getSandboxModes',
        'getSkills',
        'getApps',
        'getCwdNotes',
        'getSubagents',
        'getChatTerminalTasks',
        'getLimitResetMessages'
      ]) {
        operations[name] = () => []
      }
      operations.getSkills = () => [{name:'native-skill',displayName:null,shortDescription:'Native skill',description:'Native IME selection fixture',path:'/fixture/native-skill/SKILL.md',scope:'repo',enabled:true}]
      globalThis.lanFixture = {
        operations,
        detail,
        summary,
        sends: 0,
        page: () => ({ chats: [chat], nextCursor: null, conversationViews: [detail()] })
      }
      host = require(path.join(directory, 'main/fixture.cjs'))
      try {
        host.registerProviderIpc()
        const preferenceClients = new Map()
        const preferenceValues = {}
        host.handleClientRequest('sele:preferences', (event, request) => {
          preferenceClients.set(event.sender.id, event.sender)
          if(request.action === 'load') return {ok:true,value:{...preferenceValues}}
          assert.equal(request.action, 'write')
          for(const [key,value] of Object.entries(request.values)) {
            if(value===null)delete preferenceValues[key]
            else preferenceValues[key]=value
          }
          for(const client of preferenceClients.values()) if(!client.isDestroyed())client.send('sele:preferences-changed',request.values)
          return {ok:true,value:null}
        })
        const sleepClients = new Map()
        let sleeping = null
        const sleep = host.createChatSleepState({
          read: async () => ({ sleeping, legacy: null }),
          write: async (value) => { sleeping = value },
          broadcast: (state) => { for (const client of sleepClients.values()) if (!client.isDestroyed()) client.send(host.appIpcChannels.chatSleepUpdated, state) }
        })
        host.handleClientRequest(host.appIpcChannels.getChatSleep, (event) => {
          sleepClients.set(event.sender.id, event.sender)
          return sleep.getState()
        })
        host.handleClientRequest(host.appIpcChannels.updateChatSleep, (_event, changes) => sleep.update(changes))
        const defaults = {
          getDefaultCwd: '/fixture',
          getProjects: [{cwd:'/fixture',name:'A project with a long name that should wrap in the sidebar',additionalCwds:[],icon:null,sidebarOrder:null,addedAt:1,updatedAt:1}],
          getDeletedProjectCwds: [],
          getContainerSuggestions: [],
          getSshEnvironments: [],
          getProjectIcon: null,
          getFileTree: {repositoryRoot:'/fixture',branchName:'main',files:[{path:'README.md'}]},
          getFileTreeListing: {repositoryRoot:'/fixture',branchName:'main',fileCount:1,paths:'README.md'},
          getGitHubPullRequests: {repository:'fixture/sele',totalCount:1,page:1,pageCount:1,pullRequests:[{number:123,title:'Phone pull request',url:'https://github.com/fixture/sele/pull/123',state:'open',isDraft:false,author:'fixture'}]},
          getGitHubPullRequest: {number:123,title:'Phone pull request',url:'https://github.com/fixture/sele/pull/123',state:'open',isDraft:false,author:'fixture',repository:'fixture/sele',body:'Mobile PR detail',baseRefName:'main',headRefName:'phone',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),mergedAt:null,closedAt:null,additions:1,deletions:0,changedFiles:1,reviewDecision:'REVIEW_REQUIRED',activity:[]},
          getSourceAvailability: {
            gitAvailable: Boolean(process.env.SELE_ANDROID_WORKSPACE_ONLY),
            providers: [{ providerId: 'codex', available: true }]
          }
        }
        if (process.env.SELE_ANDROID_WORKSPACE_ONLY) Object.assign(defaults, {
          getGitChanges: {repositoryRoot:'/fixture',branchName:'feature/a-long-branch-name-for-phone-layout',baseRef:'HEAD',unpulledCount:12,unpushedCount:345,untrackedFilesHiddenForPerformance:false,files:[]},
          getGitBranches: {repositoryRoot:'/fixture',currentBranch:'feature/a-long-branch-name-for-phone-layout',branches:['main','feature/a-long-branch-name-for-phone-layout']}
        })
        for (const [name, value] of Object.entries(defaults)) {
          host.handleClientRequest(host.appIpcChannels[name], () => value)
        }
        host.handleClientRequest(host.terminalIpcChannels.listAgentSessions, () => [])
        await host.registerLocalAccess({
          assetsDirectory: path.resolve(process.env.SELE_TEST_RENDERER_DIR || 'out/renderer'),
          devRendererUrl: process.env.ELECTRON_RENDERER_URL
        })
        if (process.argv.includes('--restore')) {
          const restored = await handlers.get(host.localAccessChannels.getState)({})
          assert.equal(restored.enabled, true)
          assert.ok(restored.urls.length)
          assert.equal(restored.error, null)
          console.log('LOCAL ACCESS RESTART PASSED')
          return
        }
        assert.equal((await handlers.get(host.localAccessChannels.getState)({})).enabled, false)
        const port = await new Promise((resolve) => {
          const probe = require('node:net').createServer()
          probe.listen(0, '127.0.0.1', () => {
            const port = probe.address().port
            probe.close(() => resolve(port))
          })
        })
        let state = await handlers.get(host.localAccessChannels.configure)(
          {},
          { enabled: true, port }
        )
        assert.ok(state.urls.length, 'an actual LAN address is needed to test insecure HTTP')
        const { Bonjour } = require('bonjour-service')
        const discovery = new Bonjour()
        let browser
        try {
          const advertisement = await new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Sele did not advertise its local service.')),
              12000
            )
            browser = discovery.find({ type: 'sele' }, (service) => {
              if (service.port !== port) return
              clearTimeout(timeout)
              resolve(service)
            })
          })
          assert.equal(advertisement.txt.version, '1')
          assert.match(advertisement.txt.id, /^[a-f0-9-]{36}$/)
          assert.equal(
            Object.keys(advertisement.txt).some((key) => /token|secret|key/i.test(key)),
            false
          )
          console.log(
            'LOCAL DISCOVERY PASSED: public service identity and port; no access credentials'
          )
        } finally {
          browser?.stop()
          discovery.destroy()
        }
        const link = state.urls[0]
        if (process.env.SELE_TEST_MOBILE_WEB) {
          await require('./mobile-web-local-access.cjs')({
            link,
            port,
            sends: () => globalThis.lanFixture.sends,
            configure: (options) => handlers.get(host.localAccessChannels.configure)({}, options),
            getState: () => handlers.get(host.localAccessChannels.getState)({}),
            decidePairing: (id, approve) =>
              handlers.get(host.localAccessChannels.decidePairing)({}, id, approve),
            revokeDevice: (id) => handlers.get(host.localAccessChannels.revokeDevice)({}, id)
          })
          return
        }
        if (process.env.SELE_ANDROID_TEST_SERIAL) {
          await require('./android-local-access.cjs')({
            link,
            port,
            sends: () => globalThis.lanFixture.sends,
            getState: () => handlers.get(host.localAccessChannels.getState)({}),
            decidePairing: (id, approve) =>
              handlers.get(host.localAccessChannels.decidePairing)({}, id, approve),
            revokeDevice: (id) => handlers.get(host.localAccessChannels.revokeDevice)({}, id),
            configure: (options) => handlers.get(host.localAccessChannels.configure)({}, options)
          })
          return
        }
        const errors = []
        const makeWindow = () => {
          const target = new BrowserWindow({
            show: true,
            width: 1200,
            height: 850,
            webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false }
          })
          target.webContents.on('console-message', (details) => {
            if (details.level === 'error') errors.push(details.message)
          })
          target.webContents.session.webRequest.onCompleted((details) => {
            if (details.statusCode >= 400) errors.push(`HTTP ${details.statusCode}: ${details.url}`)
          })
          return target
        }
        window = makeWindow()
        const run = (source) => window.webContents.executeJavaScript(source)
        const waitFor = async (source) => {
          const start = Date.now()
          while (Date.now() - start < 15000) {
            if (await run(source)) return
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(
            'Timed out: ' +
              source +
              '\n' +
              (await run('document.body.innerText')) +
              '\n' +
              errors.join('\n')
          )
        }
        console.log('LOCAL UI: opening first client')
        await window.loadURL(link)
        await waitFor('Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))')
        assert.equal(
          await run('window.isSecureContext'),
          false,
          'test the same HTTP constraints as a phone'
        )
        assert.equal(await run('typeof crypto.randomUUID'), 'function')
        assert.equal(await run('location.hash'), '')
        assert.match(
          await run('localAccessApi.getState().catch(error => error.message)'),
          /desktop app/
        )
        await run(
          'document.querySelector(\'[data-chat-id="lan-fixture"] .chat-list-item__main\').click()'
        )
        await waitFor(
          'document.getElementById("chat-search-content")?.textContent.includes("Saved LAN answer")'
        )
        await run(`(() => {
        const textarea = document.querySelector('.chat-panel__composer textarea')
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Hello from the phone')
        textarea.dispatchEvent(new Event('input', {bubbles:true}))
      })()`)
        await new Promise((resolve) => setTimeout(resolve, 150))
        await run(
          `document.querySelector('.chat-panel__composer textarea').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true}))`
        )
        await waitFor(
          'document.getElementById("chat-search-content")?.textContent.includes("Live answer over the LAN")'
        )
        await run(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        await run(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        assert.equal(globalThis.lanFixture.sends, 1)
        // Upload uses browser File bytes, not an Electron-only host file path.
        const attachment = await run(
          `appApi.getDroppedMessageAttachments([new File(['phone attachment'], 'phone.txt', {type:'text/plain'})])`
        )
        assert.equal(attachment[0].kind, 'file')
        assert.equal(await fs.readFile(attachment[0].path, 'utf8'), 'phone attachment')
        // A native picker can outlive its Wi-Fi connection. Reconnecting must
        // preserve the picker, then persist all selected images before reload.
        window.webContents.debugger.attach('1.3')
        await run(`window.pickerSurvived = true;
          const nativeClick = HTMLInputElement.prototype.click;
          HTMLInputElement.prototype.click = function() {
            if (this.type === 'file') window.fixturePicker = this;
            else nativeClick.call(this);
          };
          document.querySelector('[aria-label="Attach files"]').click();`)
        await waitFor('Boolean(window.fixturePicker)')
        await handlers.get(host.localAccessChannels.configure)({}, { enabled: false, port })
        await waitFor('Boolean(document.getElementById("sele-connection-status"))')
        await handlers.get(host.localAccessChannels.configure)({}, { enabled: true, port })
        await waitFor('!document.getElementById("sele-connection-status")')
        await new Promise((resolve) => setTimeout(resolve, 250))
        assert.equal(await run('window.pickerSurvived'), true, 'reconnect cannot discard an open picker')
        const imageFiles = []
        for (let index = 0; index < 3; index++) {
          const imagePath = path.join(directory, `phone-${index}.png`)
          const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
          await fs.writeFile(imagePath, Buffer.concat([image, Buffer.alloc(1024 * 1024)]))
          imageFiles.push(imagePath)
        }
        const { root: pickerDocument } = await window.webContents.debugger.sendCommand('DOM.getDocument')
        const { nodeId: pickerNode } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: pickerDocument.nodeId, selector: 'input[type="file"]'
        })
        await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
          nodeId: pickerNode, files: imageFiles
        })
        await waitFor('!window.pickerSurvived && Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))')
        await run('document.querySelector(\'[data-chat-id="lan-fixture"] .chat-list-item__main\').click()')
        await waitFor('document.querySelectorAll(\'.message-box__attachment-preview--image\').length === 3')
        assert.equal(globalThis.lanFixture.sends, 1, 'attachment recovery does not replay chat sends')
        window.webContents.debugger.detach()
        await run(`preferencesApi.setItem('sele:lan-fixture-draft', 'keep on phone')`)
        // Access keys are per tab; settings and drafts live on the host.
        console.log('LOCAL UI: first client sent and uploaded; opening second')
        second = makeWindow()
        await second.loadURL(link)
        await second.webContents.executeJavaScript(`new Promise(resolve => {
        const timer=setInterval(()=>{if(document.querySelector('[data-chat-id="lan-fixture"]')){clearInterval(timer);resolve()}},25);setTimeout(()=>{clearInterval(timer);resolve()},20000)
      })`)
        assert.equal(
          await second.webContents.executeJavaScript(
            `preferencesApi.getItem('sele:lan-fixture-draft').value`
          ),
          'keep on phone'
        )
        // Turning access off disconnects both clients; reopening refreshes state
        // without reissuing the send that already reached the host.
        console.log('LOCAL UI: second client ready; restarting server')
        await handlers.get(host.localAccessChannels.configure)({}, { enabled: false, port })
        await waitFor('Boolean(document.getElementById("sele-connection-status"))')
        await handlers.get(host.localAccessChannels.configure)({}, { enabled: true, port })
        await waitFor(
          '!document.getElementById("sele-connection-status") && Boolean(window.providerApi)'
        )
        await waitFor('Boolean(document.querySelector(\'[data-chat-id="lan-fixture"]\'))')
        assert.equal(globalThis.lanFixture.sends, 1)
        assert.equal(
          await run(`preferencesApi.getItem('sele:lan-fixture-draft').value`),
          'keep on phone'
        )
        // Compact media rules must have no effect on a wide desktop workspace.
        const hoverPoint = await run(`(()=>{const r=document.querySelector('[data-chat-id="lan-fixture"] .chat-list-item__main').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
        window.webContents.sendInputEvent({ type: 'mouseMove', ...hoverPoint })
        await waitFor('Boolean(document.querySelector(".chat-list-item__detail-card"))')
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 })
        await waitFor('!document.querySelector(".chat-list-item__detail-card")')
        console.log('DESKTOP HOVER PASSED: mouse details preserved')
        await run('document.querySelector(\'[data-chat-id="lan-fixture"] .chat-list-item__main\').click()')
        await waitFor('document.getElementById("chat-search-content")?.textContent.includes("Live answer over the LAN")')
        await run(`(async () => {
          await document.fonts.ready;
          const style=document.createElement('style');style.id='desktop-comparison-freeze';
          style.textContent='*,*::before,*::after {animation:none!important;transition:none!important;caret-color:transparent!important}';
          document.head.append(style);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        })()`)
        assert.equal(await run('Boolean(document.querySelector(".mobile-conversation-header"))'), false)
        await run(`(async()=>{await new Promise(resolve=>setTimeout(resolve,350));for(const animation of document.getAnimations()){try{animation.finish()}catch{animation.pause()}}})()`)
        const desktopBefore = await window.webContents.capturePage()
        const disabled = await run(`(() => {
          window.__seleMobileMedia=[];
          for(const sheet of document.styleSheets) for(const rule of sheet.cssRules) {
            if(rule.type!==CSSRule.MEDIA_RULE || !/max-width:\\s*(50|65)rem/.test(rule.conditionText)) continue;
            window.__seleMobileMedia.push([rule.media,rule.media.mediaText]);rule.media.mediaText='not all';
          }
          return window.__seleMobileMedia.length;
        })()`)
        assert.ok(disabled > 0, 'the built renderer contains its compact layout media rules')
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        const desktopAfter = await window.webContents.capturePage()
        await fs.mkdir(path.resolve('test-results/local-access'), { recursive: true })
        await fs.writeFile(path.resolve('test-results/local-access/desktop-before.png'), desktopBefore.toPNG())
        await fs.writeFile(path.resolve('test-results/local-access/desktop-after.png'), desktopAfter.toPNG())
        assert.ok(desktopAfter.toBitmap().equals(desktopBefore.toBitmap()), 'desktop pixels stay unchanged when compact CSS is removed')
        await run(
          `window.__seleMobileMedia.forEach(([media,text])=>media.mediaText=text);document.getElementById('desktop-comparison-freeze').remove()`
        )
        await fs.mkdir(path.resolve('test-results/local-access'), { recursive: true })
        await fs.writeFile(
          path.resolve('test-results/local-access/desktop.png'),
          desktopBefore.toPNG()
        )
        console.log('DESKTOP LAYOUT PASSED: identical pixels with compact CSS disabled')
        window.setSize(420, 820)
        await waitFor('Boolean(document.querySelector(".mobile-conversation-header"))')
        await run('document.querySelector(".mobile-conversation-header button[aria-label=\\"Open sidebar\\"]").click()')
        await waitFor('document.querySelector("main.chat")?.dataset.mobilePane === "chats"')
        await run(
          'document.querySelector(\'[data-chat-id="lan-fixture"] .chat-list-item__main\').click()'
        )
        await waitFor('document.querySelector("main.chat")?.dataset.mobilePane === "conversation"')
        await waitFor(
          'document.getElementById("chat-search-content")?.textContent.includes("Live answer over the LAN")'
        )
        await fs.mkdir(path.resolve('test-results/local-access'), { recursive: true })
        await fs.writeFile(
          path.resolve('test-results/local-access/phone.png'),
          (await window.webContents.capturePage()).toPNG()
        )
        state = await handlers.get(host.localAccessChannels.configure)(
          {},
          { enabled: true, port, resetToken: true }
        )
        assert.notEqual(state.urls[0], link)
        const saved = JSON.parse(
          await fs.readFile(path.join(directory, 'profile/local-access.json'), 'utf8')
        )
        assert.equal(saved.enabled, true)
        if (process.platform !== 'win32')
          assert.equal(
            (await fs.stat(path.join(directory, 'profile/local-access.json'))).mode & 0o777,
            0o600
          )
        assert.deepEqual(
          errors.filter(
            (message) =>
              !message.includes('Connection lost.') && !message.includes('Sele is disconnected.')
          ),
          [],
          'the unchanged UI must run without unexpected renderer errors'
        )
        console.log(
          'LOCAL ACCESS UI PASSED: HTTP, chat loading/sending/streaming, uploads, two clients, reconnect, revocation, phone viewport'
        )
      } catch (error) {
        console.error(error)
        exitCode = 1
      } finally {
        window?.destroy()
        second?.destroy()
        await host.stopLocalAccess()
        app.exit(exitCode)
      }
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
