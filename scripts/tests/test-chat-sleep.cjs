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
            import { ChatListGroup } from './src/renderer/src/components/ChatListGroup'
            import { ChatSleepActionsContext } from './src/renderer/src/chatSleep'
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
            const Fixture = () => {
              const [sleepAction, setSleepAction] = React.useState('sleep')
              window.setSleepAction = setSleepAction
              return <ChatSleepActionsContext.Provider value={sleepAction}>
              <aside style={{width:280,padding:24}}>
                <ChatList chats={[chat]} selectedChatKey={null} onMarkDone={noop} onRename={noop}
                  onResolveApproval={noop} onSelect={noop} onTogglePinned={noop} />
                <ChatListGroup open visibleChatCount={1}
                  group={{ key: 'cwd:/project', cwd: '/project', label: 'Project', kind: 'cwd',
                    chats: [{ ...chat, id: 'b' }, { ...chat, id: 'c', providerId: 'claude' }] }}
                  selectedChatKey={null} onMarkChatDone={noop} onMarkCwdChatsDone={noop}
                  onNewChatInCwd={noop} onRenameChat={noop} onResolveApproval={noop}
                  onReorderChats={noop} onSelectChat={noop} onToggle={noop}
                  onToggleChatPinned={noop} onUnpinPinnedChats={noop} />
              </aside>
              </ChatSleepActionsContext.Provider>
            }
            createRoot(document.getElementById('root')).render(<Fixture />)
          `,
          loader: 'tsx',
          resolveDir: process.cwd()
        },
        bundle: true,
        outfile: path.join(directory, 'fixture.js'),
        define: { 'process.env.NODE_ENV': '"production"' },
        jsx: 'automatic',
        loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
        plugins: [
          {
            name: 'unused-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ],
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
        width: 1000,
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

      const projectSleep = 'Sleep all chats in project Project'
      const projectDropdown = `${projectSleep} for a set time`
      const clickButton = (label) =>
        run(`document.querySelector('[aria-label="${label}"]').click()`)
      assert.deepEqual(
        await run(`(() => {
        const row = document.querySelector('.chat-list-group__action');
        return [...row.querySelectorAll('button')].map(button => button.getAttribute('aria-label'));
      })()`),
        ['New chat in Project', projectSleep, projectDropdown, 'Mark all Project chats done']
      )
      await clickButton(projectDropdown)
      await wait(250)
      if (process.env.SELE_TEST_SCREENSHOT_PATH) {
        await fs.writeFile(
          process.env.SELE_TEST_SCREENSHOT_PATH,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      assert.equal(
        await run(`(() => {
        const panel = document.querySelector('.ui-button-menu').getBoundingClientRect();
        return panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= innerHeight;
      })()`),
        true,
        'project sleep dropdown stays inside the viewport'
      )
      assert.equal(
        await run(`document.activeElement?.getAttribute('aria-label')`),
        'Sleep duration'
      )
      assert.equal(
        await run(
          `document.querySelector('.ui-button-menu[role="dialog"]').getAttribute('aria-label')`
        ),
        projectDropdown
      )
      assert.equal(
        await run(`getComputedStyle(document.querySelector('.chat-list-group__action')).opacity`),
        '1',
        'project actions stay visible while the dropdown has focus'
      )
      await run(`document.querySelector('[aria-label="Sleep for 1h"]').click()`)
      await wait(250)
      const projectTimers = JSON.parse(await storedSleep())
      assert.deepEqual(Object.keys(projectTimers).sort(), ['claude:c', 'codex:a', 'codex:b'])
      assert.equal(projectTimers['codex:a'], null, 'another chat keeps its existing sleep')
      assert.equal(
        projectTimers['codex:b'],
        projectTimers['claude:c'],
        'all project chats share the deadline, including the unrendered page'
      )
      assert.ok(Math.abs(projectTimers['codex:b'] - Date.now() - 3600000) < 5000)
      assert.equal(await run(`document.querySelector('.ui-button-menu')`), null)

      await clickButton(projectDropdown)
      await wait(250)
      await typeDuration('2h 15m')
      await wait(50)
      await run(`${sleepButton}.click()`)
      await wait(250)
      const customTimers = JSON.parse(await storedSleep())
      assert.equal(customTimers['codex:b'], customTimers['claude:c'])
      assert.ok(Math.abs(customTimers['codex:b'] - Date.now() - 8100000) < 5000)

      await clickButton(projectDropdown)
      await wait(250)
      await run(
        `document.querySelector('.chat-sleep-panel input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
      )
      await wait(250)
      assert.equal(
        await run(`document.querySelector('.ui-button-menu')`),
        null,
        'Escape closes the dropdown'
      )
      assert.equal(await run(`document.activeElement?.getAttribute('aria-label')`), projectDropdown)

      await clickButton(projectSleep)
      await wait(250)
      assert.deepEqual(
        JSON.parse(await storedSleep()),
        { 'codex:a': null, 'codex:b': null, 'claude:c': null },
        'main button sleeps every project chat without a timer'
      )

      await run(`window.setSleepAction('wake')`)
      await wait(100)
      const projectWake = 'Wake all chats in project Project'
      assert.equal(
        await run(`document.querySelector('[aria-label="${projectWake}"]').title`),
        projectWake
      )
      assert.equal(await run(`document.querySelector('[aria-label="${projectSleep}"]')`), null)
      await clickButton(projectDropdown)
      await wait(250)
      await run(`document.querySelector('[aria-label="Sleep for 30m"]').click()`)
      await wait(250)
      const rescheduled = JSON.parse(await storedSleep())
      assert.equal(rescheduled['codex:a'], null)
      assert.equal(rescheduled['codex:b'], rescheduled['claude:c'])
      assert.ok(
        Math.abs(rescheduled['codex:b'] - Date.now() - 1800000) < 5000,
        'the sleeping tab dropdown reschedules sleep'
      )

      await clickButton(projectWake)
      await wait(250)
      assert.deepEqual(
        JSON.parse(await storedSleep()),
        { 'codex:a': null },
        'Wake all clears every project timer, including chats beyond the visible page'
      )

      await run(`window.setSleepAction('sleep')`)
      await wait(100)
      assert.equal(
        await run(`Boolean(document.querySelector('[aria-label="${projectSleep}"]'))`),
        true,
        'other tabs keep the Sleep action'
      )
      await run(`window.setSleepAction(false)`)
      await wait(100)
      assert.equal(
        await run(`document.querySelector('.ui-button-group')`),
        null,
        'disabling the sleeping tab hides project sleep controls'
      )
      console.log('Chat sleep checks passed')
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
