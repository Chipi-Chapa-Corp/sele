const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-chat-sleep-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { ChatList } from './src/renderer/src/components/ChatList'
            import './src/renderer/src/assets/main.css'
            const stored = new Map()
            window.preferencesApi = {
              getItem: key => ({ok: true, value: stored.get(key) ?? null}),
              setItem: (key, value) => { stored.set(key, value); return {ok: true, value: null} },
              removeItem: key => { stored.delete(key); return {ok: true, value: null} }
            }
            const noop = () => {}
            const chat = { id: 'a', providerId: 'codex', title: 'Conversation a', createdAt: Date.now(),
              updatedAt: Date.now(), cwd: '/project', status: null }
            createRoot(document.getElementById('root')).render(
              <aside style={{width:280,padding:24}}>
                <ChatList chats={[chat]} selectedChatKey={null} onMarkDone={noop} onRename={noop}
                  onResolveApproval={noop} onSelect={noop} onTogglePinned={noop} />
              </aside>
            )
          `,
          loader: 'tsx',
          resolveDir: process.cwd()
        },
        bundle: true,
        outfile: path.join(directory, 'fixture.js'),
        define: { 'process.env.NODE_ENV': '"production"' },
        jsx: 'automatic',
        loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
        logLevel: 'silent'
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Chat sleep checks passed')) {
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
      const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: { offscreen: true, backgroundThrottling: false }
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true
      })
      const run = (source) => win.webContents.executeJavaScript(source)
      const wait = (ms) => run(`new Promise(resolve => setTimeout(resolve, ${ms}))`)
      const openMenu = async () => {
        await run(`document.querySelector('[data-chat-id="a"] .ui-dropdown__trigger').click()`)
        await wait(250)
      }
      const storedSleep = () => run(`window.preferencesApi.getItem('sele:sleeping-chats:v1').value`)

      await wait(300)
      await openMenu()
      await run(`document.querySelector('.ui-dropdown__action-toggle').click()`)
      await wait(250)
      const layout = await run(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const toggle = rect('.ui-dropdown__action-toggle');
        const action = rect('.ui-dropdown__action-row .ui-dropdown__action');
        const panel = rect('.ui-dropdown__action-panel');
        const pinRow = [...document.querySelectorAll('.ui-dropdown__action')].at(-1).getBoundingClientRect();
        return {
          chevronRightOfAction: toggle.left >= action.right,
          chevronSquare: toggle.width === toggle.height && toggle.height === action.height,
          panelBelowChevron: panel.top >= toggle.bottom,
          panelOnScreen: panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight,
          // The panel must paint above the menu rows it drops over.
          panelOnTop: Boolean(document.elementFromPoint(pinRow.left + 4, pinRow.top + pinRow.height / 2)?.closest('.ui-dropdown__action-panel')),
          focused: document.activeElement?.getAttribute('aria-label'),
          presets: [...document.querySelectorAll('.chat-sleep-panel__presets button')].map(button => button.textContent)
        };
      })()`)
      assert.deepEqual(layout, {
        chevronRightOfAction: true,
        chevronSquare: true,
        panelBelowChevron: true,
        panelOnScreen: true,
        panelOnTop: true,
        focused: 'Sleep duration',
        presets: ['30m', '1h', '1d']
      })

      const typeDuration = (text) =>
        run(`(() => {
          const input = document.querySelector('.chat-sleep-panel input');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`)
      const sleepButton = `document.querySelector('.chat-sleep-panel__custom button')`
      await typeDuration('soon')
      await wait(50)
      assert.equal(await run(`${sleepButton}.disabled`), true)
      await typeDuration('1w 3d 5h 6m')
      await wait(50)
      assert.equal(await run(`${sleepButton}.disabled`), false)
      const sleptAt = Date.now()
      await run(`${sleepButton}.click()`)
      await wait(250)
      const sleepDuration = (10 * 24 * 60 + 5 * 60 + 6) * 60000
      const wakeAt = JSON.parse(await storedSleep())['codex:a']
      assert.ok(
        Math.abs(wakeAt - sleptAt - sleepDuration) < 5000,
        'the typed duration sets the timer'
      )
      assert.equal(await run(`document.querySelector('.ui-dropdown__action-panel')`), null)

      // A sleeping chat offers waking up, and its panel reports the remaining time.
      await openMenu()
      assert.equal(
        await run(`document.querySelector('.ui-dropdown__action').textContent`),
        'Wake up'
      )
      await run(`document.querySelector('.ui-dropdown__action-toggle').click()`)
      await wait(100)
      assert.equal(
        await run(`document.querySelector('.chat-sleep-panel__status').textContent`),
        'Wakes in 1w 3d 5h 6m'
      )
      await run(`document.querySelector('.ui-dropdown__action').click()`)
      await wait(250)
      assert.equal(await storedSleep(), null, 'waking up clears the timer')

      await openMenu()
      assert.equal(await run(`document.querySelector('.ui-dropdown__action').textContent`), 'Sleep')
      await run(`document.querySelector('.ui-dropdown__action').click()`)
      await wait(250)
      assert.deepEqual(JSON.parse(await storedSleep()), { 'codex:a': null }, 'no timer by default')
      console.log('Chat sleep checks passed')
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
