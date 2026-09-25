const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-responsive-'))
    try {
      await require('esbuild').build({
        entryPoints: [path.resolve(__dirname, '../../src/renderer/src/components/vegvisir.worker.ts')],
        bundle: true,
        outfile: path.join(directory, 'vegvisir.worker.js')
      })
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChatList } from './src/renderer/src/components/ChatList'
            import { ConversationEmptyState } from './src/renderer/src/workspace/components/ConversationEmptyState'
            import { ChangesSidebarGitState } from './src/renderer/src/components/AppStatusStates'
            import { MessageBox } from './src/renderer/src/components/MessageBox'
            import './src/renderer/src/App.css'
            import './src/renderer/src/assets/main.css'
            const noop = () => {}
            const chats = Array.from({length: 300}, (_, i) => ({
              id: String(i), providerId: 'codex', title: 'Conversation ' + i,
              cwd: '/project', createdAt: Date.now() - i * 60000,
              updatedAt: Date.now() - i * 60000, status: null
            }))
            const root = createRoot(document.getElementById('root'))
            window.artKey = 0
            window.renderWorkspace = (revision = 0) => flushSync(() => root.render(
              <React.StrictMode><main style={{display:'flex', height:'100vh'}}>
                <aside style={{width:280, overflow:'auto'}}><ChatList chats={chats}
                  selectedChatKey={null} onMarkDone={noop} onRename={noop}
                  onResolveApproval={noop} onSelect={noop} onTogglePinned={noop}/></aside>
                <div className="chat-panel">
                  <ConversationEmptyState key={window.artKey} visible/>
                  <MessageBox autoFocus draftScopeKey="new" draftProjectKey="project"
                    providerId="codex" model="test" models={[{id:'test', label:'Test', description:'Test model', isDefault:true, supportedReasoningEfforts:[], defaultReasoningEffort:'medium'}]}
                    agentMode="default" agentModes={[]} approvalMode="on-request" approvalModes={[]}
                    sandboxMode="workspace-write" sandboxModes={[]} reasoningEffort="medium" serviceTier={null}
                    accountUsage={null} accountUsageError={null} accountUsageState="idle"
                    contextUsage={{source:'unavailable', usedTokens:null, maxTokens:null}} displayUsage="context"
                    onAgentModeChange={noop} onApprovalModeChange={noop} onModelChange={noop}
                    onReasoningEffortChange={noop} onServiceTierChange={noop} onSandboxModeChange={noop}
                    onSend={() => true}/>
                </div>
                <ChangesSidebarGitState active label={'Loading changes ' + revision}/>
              </main></React.StrictMode>
            ))
            window.renderWorkspace()
          `,
          loader: 'tsx',
          resolveDir: path.resolve(__dirname, '../..')
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'art-worker',
            setup(build) {
              build.onResolve({ filter: /vegvisir\.worker\?worker$/ }, () => ({
                path: 'art-worker',
                namespace: 'art-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'art-worker' }, () => ({
                contents: `window.activeArtWorkers = 0;
                  export default class extends Worker {
                    constructor() { super(new URL('vegvisir.worker.js', document.baseURI)); window.activeArtWorkers++; }
                    terminate() { super.terminate(); if (!this.disposed) { this.disposed = true; window.activeArtWorkers--; } }
                  }`
              }))
            }
          },
          ...(process.argv.includes('--baseline')
            ? [
                {
                  name: 'baseline',
                  setup(build) {
                    build.onLoad(
                      {
                        filter:
                          /(?:ChatListItem\.tsx|semanticDateDifference\.ts|VegvisirArt\.tsx|conversation-panel\.css)$/
                      },
                      (args) => ({
                        contents: require('node:child_process').execFileSync(
                          'git',
                          [
                            'show',
                            'HEAD:' + path.relative(path.resolve(__dirname, '../..'), args.path)
                          ],
                          { encoding: 'utf8' }
                        ),
                        loader: args.path.endsWith('.css')
                          ? 'css'
                          : args.path.endsWith('.tsx')
                            ? 'tsx'
                            : 'ts'
                      })
                    )
                  }
                }
              ]
            : [])
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css">
        <div id="root"></div><script src="fixture.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [
          __filename,
          directory,
          '--no-sandbox',
          ...(process.argv.includes('--baseline') ? ['--baseline'] : [])
        ],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Responsiveness checks passed')) {
        process.stderr.write(result.stderr || String(result.error || 'Electron check failed'))
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
  const { app, BrowserWindow } = require('electron')
  app.whenReady().then(async () => {
    let code = 0
    try {
      const rendererErrors = []
      const win = new BrowserWindow({
        show: false,
        width: 1500,
        height: 950,
        webPreferences: { offscreen: true, backgroundThrottling: false }
      })
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') rendererErrors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true
      })
      await run(
        `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
      )
      await run(`document.querySelector('textarea').focus()`)
      const timing = await run(`(() => {
        window.art = document.querySelector('.chat-panel__new-chat-vegvisir')
        const times = []
        for (let i = 0; i < 20; i++) {
          const start = performance.now()
          window.renderWorkspace(i)
          times.push(performance.now() - start)
        }
        return {median:times.sort((a,b)=>a-b)[10], max:Math.max(...times)}
      })()`)
      // Restart the art immediately before typing. The render benchmark above can outlast
      // the entire animation, so it must not be used as the animation's start time.
      await run(`window.artKey++; window.renderWorkspace();
        window.art = document.querySelector('.chat-panel__new-chat-vegvisir');
        window.frameGaps = []; window.lastFrame = performance.now(); window.recordFrames = true;
        requestAnimationFrame(function sample(now) {
          window.frameGaps.push(now - window.lastFrame); window.lastFrame = now;
          if(window.recordFrames) requestAnimationFrame(sample);
        });`)
      // Type into the real composer while asynchronous Git-style updates and SVG animation run.
      await run(
        `window.updates = 0; window.timer = setInterval(() => window.renderWorkspace(++window.updates), 40)`
      )
      const message = 'Typing while Git loads'
      const keyLatencies = []
      for (const text of message) {
        const start = performance.now()
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text })
        await run('new Promise(resolve => requestAnimationFrame(resolve))')
        keyLatencies.push(performance.now() - start)
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      await run(`new Promise(resolve => setTimeout(resolve, 120))`)
      await run(`clearInterval(window.timer); window.recordFrames = false`)
      assert.ok(await run('window.updates > 0'), 'the workspace refreshed during the typing check')
      assert.equal(await run(`document.querySelector('textarea').value`), message)
      assert.equal(await run(`document.activeElement === document.querySelector('textarea')`), true)
      if (!process.argv.includes('--baseline')) {
        assert.equal(
          await run(`window.art.style.getPropertyValue('--vegvisir-angle')`),
          `${message.length * 6}deg`,
          'typing turns the artwork forward'
        )
        assert.equal(
          await run(`(() => {
            const input = document.querySelector('textarea');
            input.value = input.value.slice(0, -1);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return window.art.style.getPropertyValue('--vegvisir-angle');
          })()`),
          `${(message.length - 1) * 6}deg`,
          'removing text turns the artwork backward'
        )
      }
      assert.equal(
        await run(`window.art === document.querySelector('.chat-panel__new-chat-vegvisir')`),
        true,
        'background refreshes must not restart the new-chat drawing'
      )
      assert.deepEqual(rendererErrors, [], 'the animation and composer must not throw')
      if (!process.argv.includes('--baseline')) {
        assert.equal(
          await run(`!!window.art.querySelector('canvas')`),
          true,
          'drawing uses a worker canvas'
        )
        assert.equal(
          await run('window.activeArtWorkers'),
          1,
          'Strict Mode and remounts must dispose old workers'
        )
        assert.equal(
          await run(
            `document.getAnimations().some(a => a.animationName === 'new-chat-vegvisir-draw-stroke')`
          ),
          false,
          'no SVG stroke animation may run on the input thread'
        )
      }
      // Compare the completed worker drawing against the original vector geometry.
      await run('new Promise(resolve => setTimeout(resolve, 350))')
      await run(`document.documentElement.dataset.colorScheme = 'light'; window.art.style.width = '65%';
        window.art.style.setProperty('--vegvisir-angle', '0deg');
        window.art.querySelector('canvas').style.animation = 'none';
        window.art.querySelector('canvas').style.transform = 'none';
        window.art.querySelector('canvas').style.transition = 'none';
        new Promise(resolve => setTimeout(resolve, 120))`)
      const artBounds = await run(`(() => {
        const rect = window.art.getBoundingClientRect()
        return {x:Math.ceil(rect.x), y:Math.ceil(rect.y), width:Math.floor(rect.width), height:Math.floor(rect.height)}
      })()`)
      const animatedArt = await win.webContents.capturePage(artBounds)
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      assert.equal(
        await run(`getComputedStyle(window.art.querySelector('path')).animationName`),
        'none'
      )
      if (!process.argv.includes('--baseline')) {
        assert.equal(await run('window.activeArtWorkers'), 0, 'reduced motion must stop the worker')
      }
      const staticArt = await win.webContents.capturePage(artBounds)
      const animatedPixels = animatedArt.toBitmap()
      const staticPixels = staticArt.toBitmap()
      assert.equal(animatedPixels.length, staticPixels.length)
      let difference = 0
      let artworkContrast = 0
      for (let index = 0; index < staticPixels.length; index += 4) {
        for (let channel = 0; channel < 3; channel++) {
          difference += Math.abs(animatedPixels[index + channel] - staticPixels[index + channel])
          artworkContrast += Math.abs(staticPixels[index + channel] - staticPixels[channel])
        }
      }
      assert.ok(artworkContrast > 0, 'the reference artwork must be visible')
      assert.ok(
        difference / artworkContrast < 0.25,
        `worker drawing must match SVG geometry (relative pixel error ${difference / artworkContrast})`
      )
      if (process.env.SELE_ART_SCREENSHOTS) {
        await fs.writeFile('/tmp/sele-art-worker.png', animatedArt.toPNG())
        await fs.writeFile('/tmp/sele-art-svg.png', staticArt.toPNG())
      }
      console.log(
        'Responsiveness checks passed:',
        JSON.stringify({
          chatRows: 300,
          renderMs: timing,
          typingToFrameMs: { max: Math.max(...keyLatencies) },
          animationFrames: await run(
            '({count:window.frameGaps.length, maxGap:Math.max(...window.frameGaps)})'
          )
        })
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
