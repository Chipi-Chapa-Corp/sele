const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sele-compact-controls-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React, { useState } from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { CompactWindowTitlebar, MobileWorkspaceNavigation } from './src/renderer/src/workspace/components/MobileWorkspaceChrome'
            import { useWorkspaceChrome } from './src/renderer/src/workspace/features/useWorkspaceChrome'
            import { useCompactLayout } from './src/renderer/src/useCompactLayout'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/App.css'
            const root = createRoot(document.getElementById('root'))
            function Fixture({ position = 'right', pane = 'conversation', sidebarOpen = false }) {
              const compact = useCompactLayout()
              const [windowState, setWindowState] = useState({ isMaximized: false })
              const chrome = useWorkspaceChrome({
                dialogState: { windowState, setWindowState },
                settings: { settingsPanelSettings: { appearance: { position } },
                  effectiveAppSettings: { appearance: { controlStyle: 'secondary' } } },
                preferences: { setSettingsOpen() {} }
              })
              return <main className="chat" data-mobile-pane={compact ? sidebarOpen ? 'chats' : pane : undefined}
                data-mobile-view={compact ? pane : undefined}>
                {compact && <CompactWindowTitlebar renderWindowControls={chrome.renderWindowControls} />}
                {compact && <MobileWorkspaceNavigation pane={pane} sidebarOpen={sidebarOpen}
                  title="A conversation with a long title" onPane={() => {}} onNewChat={() => {}} onBack={() => {}} />}
                <div className="chat__panels">
                  <button className="mobile-sidebar-backdrop" data-open={sidebarOpen} />
                  <div id="sidebar" data-panel className="chat__sidebar-panel" inert={compact && !sidebarOpen}>
                    {chrome.renderWindowControls('darwin')}
                    <div className="chat-sidebar">Chats</div>
                  </div>
                  <div id="detail" data-panel className="chat__detail-panel">Conversation</div>
                  <div id="changes" data-panel className="chat__changes-panel">
                    {chrome.renderWindowControls('default')}
                    <div className="changes-sidebar">Workspace</div>
                  </div>
                </div>
              </main>
            }
            window.renderFixture = (options = {}) => {
              window.seleRemoteClient = options.remote || false
              document.documentElement.dataset.platform = options.platform || 'linux'
              document.documentElement.dataset.windowControlStyle = options.style || 'default'
              document.documentElement.dataset.windowControlPosition = options.position || 'right'
              flushSync(() => root.render(<Fixture {...options} />))
            }
            window.renderFixture()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'fixture.js')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <html data-color-scheme="dark"><meta name="viewport" content="width=device-width,initial-scale=1">
        <link rel="stylesheet" href="fixture.css"><div id="root"></div>
        <script>
          window.calls = [];
          window.appApi = {
            getWindowState: async () => ({ isMaximized: false }),
            onWindowStateUpdated: () => () => {},
            minimizeWindow: () => { window.calls.push('minimize') },
            toggleWindowMaximized: async () => { window.calls.push('maximize'); return { isMaximized: true } },
            closeWindow: () => { window.calls.push('close') }
          };
        </script><script src="fixture.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox', '--ozone-platform=x11'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || result.error) {
        throw new Error(result.stderr || String(result.error || 'Compact controls fixture failed'))
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const controls = () =>
        run(`Array.from(document.querySelectorAll('.window-controls'))
        .filter(element => element.checkVisibility()).map(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            inTitlebar: !!element.closest('.compact-window-titlebar'),
            clickable: Array.from(element.querySelectorAll('button')).every(button => {
              const r = button.getBoundingClientRect();
              return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
            }) };
        })`)
      assert.equal(await run('!!document.querySelector(".compact-window-titlebar")'), false)
      assert.equal((await controls()).length, 1, 'wide desktop has one control group')
      for (const width of [780, 440]) {
        win.setContentSize(width, 800)
        await settle()
        for (const position of ['left', 'right']) {
          for (const pane of ['conversation', 'workspace']) {
            for (const sidebarOpen of [false, true]) {
              await run(`window.renderFixture(${JSON.stringify({ position, pane, sidebarOpen })})`)
              // Let the sidebar transition finish before testing hit targets.
              await run('new Promise(resolve => setTimeout(resolve, 220))')
              const groups = await controls()
              assert.equal(
                groups.length,
                1,
                'compact desktop has exactly one visible control group'
              )
              const group = groups[0]
              assert.ok(
                group.inTitlebar && group.clickable,
                'controls remain reachable above navigation and drawer'
              )
              assert.ok(group.left >= 0 && group.right <= width && group.top >= 0)
              assert.ok(position === 'left' ? group.right < width / 2 : group.left > width / 2)
              assert.ok(
                await run(
                  `document.querySelector('.mobile-conversation-header').getBoundingClientRect().top >= ${group.bottom}`
                ),
                'navigation does not overlap the controls'
              )
              assert.equal(
                await run(
                  `getComputedStyle(document.querySelector('.compact-window-titlebar')).webkitAppRegion`
                ),
                'drag'
              )
              if (sidebarOpen) {
                assert.ok(
                  await run(
                    `document.getElementById('sidebar').getBoundingClientRect().top >= ${group.bottom}`
                  ),
                  'drawer leaves the title bar accessible'
                )
              }
            }
          }
        }
      }
      await run(
        `window.renderFixture({position:'left', platform:'darwin', style:'macos', sidebarOpen:true})`
      )
      await settle()
      assert.ok((await controls())[0].clickable, 'macOS style controls stay accessible')
      for (const label of ['Minimize', 'Maximize', 'Close']) {
        await run(
          `document.querySelector('.compact-window-titlebar [aria-label="${label}"]').click()`
        )
        await settle()
      }
      assert.deepEqual(await run('window.calls'), ['minimize', 'maximize', 'close'])
      assert.equal(
        await run('!!document.querySelector(".compact-window-titlebar [aria-label=Restore]")'),
        true
      )
      for (const options of [{ position: 'hidden' }, { remote: true }]) {
        await run(`window.renderFixture(${JSON.stringify(options)})`)
        await settle()
        assert.equal(await run('!!document.querySelector(".compact-window-titlebar")'), false)
        assert.deepEqual(await controls(), [])
        assert.equal(
          await run(
            'document.querySelector(".mobile-conversation-header").getBoundingClientRect().top'
          ),
          0
        )
      }
      await run('window.renderFixture()')
      win.setContentSize(1200, 800)
      await settle()
      assert.equal(await run('!!document.querySelector(".compact-window-titlebar")'), false)
      assert.equal((await controls()).length, 1, 'resizing back restores normal desktop controls')
      console.log(
        'Compact window controls passed: resize, both positions, conversation/workspace, drawer, actions, macOS style, hidden setting and remote client'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
