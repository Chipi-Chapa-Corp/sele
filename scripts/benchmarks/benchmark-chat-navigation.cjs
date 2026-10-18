// Check navigation and resizing while the main process is occupied, without opening Sele,
// contacting providers, or accessing the user's profile. Run on an isolated display.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-navigation-'))
    const root = path.resolve(__dirname, '../..')
    const build = require('esbuild').build
    try {
      await build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ConversationPlan } from './src/renderer/src/workspace/components/ConversationPlan'
            import { ChatPlan } from './src/renderer/src/components/ChatPlan'
            import { useChatPaneLayout } from './src/renderer/src/useChatPaneLayout'
            import { preferences, initializePreferences, flushPreferences } from './src/renderer/src/preferences'
            import { writeStoredChatMessageBoxSelections } from './src/renderer/src/messageBoxPreferences'
            const root = createRoot(document.getElementById('root'))
            const resizeRoot = createRoot(document.getElementById('resize'))
            window.initializeFixture = initializePreferences
            window.flushFixture = flushPreferences
            window.preferenceWrites = []
            window.resizeRenders = 0
            function ResizeFixture() {
              window.resizeRenders++
              const layout = useChatPaneLayout(false)
              return <div ref={layout.panelsRef} style={{...layout.panelsStyle, width:1200,
                height:150, display:'grid', gridTemplateColumns:'var(--chat-sidebar-width) 16px 1fr 16px var(--chat-changes-width)'}}>
                <div>Sidebar</div>
                <div id="left-resize" ref={layout.resizeHandleRef} style={{background:'gray'}}
                  onPointerDown={event => layout.handleStartChatResize('left', event)}/>
                <div>Conversation</div>
                <div id="right-resize" ref={layout.changesResizeHandleRef} style={{background:'gray'}}
                  onPointerDown={event => layout.handleStartChatResize('right', event)}/>
                <div>Changes</div>
              </div>
            }
            window.renderResize = () => flushSync(() => resizeRoot.render(<ResizeFixture/>))
            const storage = new Map()
            const originalGet = preferences.getItem
            const originalSet = preferences.setItem
            let control = false
            preferences.getItem = key => control ? storage.get(key) ?? null : originalGet(key)
            preferences.setItem = (key, value) => {
              window.preferenceWrites.push(key)
              storage.set(key, value)
              if (!control) originalSet(key, value)
            }
            window.navigate = (key, cached = false) => {
              control = cached
              const start = performance.now()
              flushSync(() => root.render(<ConversationPlan visible selectedChatKey={key}
                messageBoxPlan={null} goal={null} onSaveGoalObjective={async () => {}}/>))
              return performance.now() - start
            }
            window.measure = async (key, cached) => {
              const start = performance.now()
              const timer = new Promise(resolve => setTimeout(() => {
                resolve(performance.now() - start)
              }, 20))
              const commitMs = window.navigate(key, cached)
              const timerMs = await timer
              return {commitMs, timerMs}
            }
            window.scheduleSelectionWrite = () => {
              control = false
              writeStoredChatMessageBoxSelections({'codex:fixture': {model:'fixture'}})
            }
            window.renderRealPlan = key => {
              const start = performance.now()
              flushSync(() => root.render(<ChatPlan key={key} plan={{contextKey:key,
                explanation:null, signature:'v1',items:[{status:'pending',step:'Test plan'}]}}/>))
              return performance.now() - start
            }
            window.measureDrag = async (startX, delta) => {
              const renders = window.resizeRenders
              const writes = window.preferenceWrites.length
              const panels = document.getElementById('left-resize').parentElement
              const before = panels.style.getPropertyValue('--chat-sidebar-width') + ':' +
                panels.style.getPropertyValue('--chat-changes-width')
              const start = performance.now()
              for (let i = 1; i <= 5; i++) {
                window.dispatchEvent(new PointerEvent('pointermove', {pointerId:1,clientX:startX+delta*i/5}))
                await new Promise(resolve => requestAnimationFrame(resolve))
              }
              const during = {renders:window.resizeRenders-renders, writes:window.preferenceWrites.length-writes,
                elapsedMs:performance.now()-start, before, after:panels.style.getPropertyValue('--chat-sidebar-width') + ':' +
                  panels.style.getPropertyValue('--chat-changes-width')}
              flushSync(() => window.dispatchEvent(new PointerEvent('pointerup', {pointerId:1})))
              return {...during, savedWrites:window.preferenceWrites.length-writes,
                finalRenders:window.resizeRenders-renders}
            }
          `,
          loader: 'tsx',
          resolveDir: root
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        outfile: path.join(directory, 'fixture.js')
      })
      await build({
        stdin: {
          contents: `
            import './src/preload/index'
            import { contextBridge, ipcRenderer } from 'electron'
            contextBridge.exposeInMainWorld('navigationFixture', {
              writeBatch: (revision, value) => ipcRenderer.invoke('sele:preferences', {
                action:'write', sourceId:'fixture-order', revision, values:{'sele:ordering':value}
              }),
              persisted: () => ipcRenderer.invoke('sele:preferences', {action:'load'}),
              blockMain: ms => new Promise(resolve => {
                ipcRenderer.once('fixture:busy-started', () => resolve())
                ipcRenderer.send('fixture:block-main', ms)
              })
            })
          `,
          resolveDir: root,
          loader: 'ts'
        },
        bundle: true,
        platform: 'node',
        external: ['electron'],
        outfile: path.join(directory, 'preload.cjs')
      })
      await build({
        entryPoints: [path.join(root, 'src/main/registerPreferences.ts')],
        bundle: true,
        platform: 'node',
        external: ['electron'],
        outfile: path.join(directory, 'storage.cjs'),
        plugins: [
          {
            name: 'fixture-native-module',
            setup(build) {
              build.onResolve({ filter: /^better-sqlite3$/ }, () => ({
                path: require.resolve('better-sqlite3'),
                external: true
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><div id="root"></div><div id="resize"></div><script src="fixture.js"></script>'
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env: environment, encoding: 'utf8', timeout: 30000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) {
        process.stderr.write(result.stderr || String(result.error))
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
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  process.env.SELE_DATABASE_PATH = path.join(directory, 'profile', 'fixture.sqlite')
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let exitCode = 0
    try {
      const requests = []
      ipcMain.on('sele:preferences', (_event, request) => requests.push(request.action))
      await require(path.join(directory, 'storage.cjs')).registerPreferences()
      ipcMain.on('fixture:block-main', (event, ms) => {
        event.sender.send('fixture:busy-started')
        // Deterministic stand-in for any main-thread task; no artificial slow SQLite.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
      })
      const window = new BrowserWindow({
        show: true,
        width: 1280,
        height: 900,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          backgroundThrottling: false
        }
      })
      const errors = []
      window.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await window.loadFile(path.join(directory, 'index.html'))
      const run = (source) => window.webContents.executeJavaScript(source)
      await run('window.initializeFixture()')
      await run('window.navigate("codex:first")')
      const beforeStable = requests.length
      const stableKey = await run(`navigationFixture.blockMain(400).then(() =>
        window.measure("codex:first", false))`)
      assert.equal(requests.length, beforeStable, 'unchanged plan key must not access storage')
      const samples = []
      for (const cached of [false, true]) {
        for (const key of ['codex:other', null]) {
          const before = requests.length
          // All dependent work runs in the renderer after the main task begins.
          const result = await run(`navigationFixture.blockMain(400).then(() =>
            window.measure(${JSON.stringify(key)}, ${cached}))`)
          samples.push({
            destination: key ?? 'new-chat / marked-done',
            storage: cached ? 'memory control' : 'production preferences',
            ...result,
            requests: requests.slice(before)
          })
          await run('window.navigate("codex:first", true)')
        }
      }
      // Deferred composer persistence must also leave the renderer responsive.
      const selectionWrite = await run(`navigationFixture.blockMain(400).then(() => {
        const start = performance.now()
        window.scheduleSelectionWrite()
        return new Promise(resolve => setTimeout(() => resolve(performance.now() - start), 150))
      })`)
      await run('window.flushFixture()')
      const planCommitMs = await run(
        `navigationFixture.blockMain(400).then(() => window.renderRealPlan('real-plan'))`
      )
      await run('window.renderResize()')
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      window.webContents.debugger.attach('1.3')
      const drags = []
      for (const edge of ['left', 'right']) {
        const bounds = await run(`(() => {
          const rect = document.getElementById('${edge}-resize').getBoundingClientRect()
          return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}
        })()`)
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          clickCount: 1,
          ...bounds
        })
        const drag = await run(
          `navigationFixture.blockMain(400).then(() => window.measureDrag(${bounds.x}, ${edge === 'left' ? 60 : -60}))`
        )
        drags.push({ edge, ...drag })
        await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          clickCount: 1,
          ...bounds
        })
        assert.equal(drag.renders, 0, 'dragging must not rerender the workspace')
        assert.equal(drag.writes, 0, 'dragging must not persist intermediate widths')
        assert.equal(
          drag.savedWrites,
          1,
          'release saves the final widths once: ' + JSON.stringify({ edge, ...drag })
        )
        assert.notEqual(drag.before, drag.after, 'CSS widths follow the pointer')
        assert.ok(
          drag.elapsedMs < 250,
          'resize frames must not wait for the busy main process: ' + JSON.stringify(drag)
        )
      }
      await run('window.flushFixture()')
      await run('navigationFixture.writeBatch(2, "new");')
      await run('navigationFixture.writeBatch(1, "stale");')
      assert.equal(
        await run('navigationFixture.persisted().then(result => result.value["sele:ordering"])'),
        'new',
        'late older batches must not overwrite a committed newer value'
      )
      assert.deepEqual(errors, [])
      for (const sample of samples) {
        assert.deepEqual(sample.requests, [])
      }
      assert.ok(samples.every((s) => s.commitMs < 200 && s.timerMs < 200))
      assert.ok(
        samples.filter((s) => s.storage === 'memory control').every((s) => s.commitMs < 200)
      )
      assert.ok(selectionWrite < 250)
      assert.ok(
        planCommitMs < 200,
        'real plans read their state without blocking on the main process'
      )
      console.log(
        JSON.stringify(
          { stableKey, samples, planCommitMs, drags, deferredComposerWriteTimerMs: selectionWrite },
          null,
          2
        )
      )
    } catch (error) {
      console.error(error)
      exitCode = 1
    }
    app.exit(exitCode)
  })
}
