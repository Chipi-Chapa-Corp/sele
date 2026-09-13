const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-goal-ui-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ConversationPlan } from './src/renderer/src/workspace/components/ConversationPlan'
            import './src/renderer/src/assets/styles/tokens.css'
            const root = createRoot(document.getElementById('root'))
            window.saved = []
            window.failSave = false
            window.goal = { threadId: 'chat', status: 'active', objective: 'Build the requested feature', createdAt: 1 }
            window.renderGoal = (updates = {}) => {
              window.goal = { ...window.goal, ...updates }
              flushSync(() => root.render(<ConversationPlan
                visible selectedChatKey="codex:chat" messageBoxPlan={null} goal={window.goal}
                onSaveGoalObjective={async objective => {
                  if (window.failSave) throw new Error('Connection lost')
                  window.saved.push(objective)
                  window.renderGoal(objective === null ? {status: 'complete'} : {objective})
                }}
              />))
            }
            window.renderGoal()
          `,
          resolveDir: path.resolve(__dirname, '..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'goal.js')
      })
      await fs.writeFile(
        path.join(directory, 'goal.html'),
        `<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="goal.css"><style>
        body { min-height:calc(100vh - 60px); margin: 30px; background: #141414; color: #eee; --composer-bg:#202020; --chat-content-max-width:60rem; --chat-font-family:system-ui; --chat-font-size:14px; --focus-ring:#aaa; }
        .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
      </style><div id="root"></div><script src="goal.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || result.error || !result.stdout.includes('Goal UI checks passed')) {
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
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 500,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      await win.loadFile(path.join(process.argv[2], 'goal.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const click = async (label) => {
        await run(`document.querySelector('[aria-label="${label}"]').click()`)
        await settle()
      }
      const setText = async (text) => {
        await run(`(() => {
          const input = document.querySelector('textarea')
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
          input.dispatchEvent(new Event('input', {bubbles: true}))
        })()`)
        await settle()
      }
      const save = async () => {
        await run("document.querySelector('form').requestSubmit()")
        await settle()
      }
      await settle()
      assert.equal(
        await run('document.querySelector(\'[aria-label="Active goal"]\') !== null'),
        true
      )
      await click('Edit goal')
      assert.equal(await run('document.activeElement.tagName'), 'TEXTAREA')
      await setText('Revised goal')
      await save()
      assert.deepEqual(await run('window.saved'), ['Revised goal'])
      assert.equal(await run("document.querySelector('textarea')"), null)
      await click('Edit goal')
      await setText('Keep this draft')
      await run('window.failSave = true')
      await save()
      assert.equal(
        await run("document.querySelector('[role=alert]').textContent"),
        'Connection lost'
      )
      assert.equal(await run("document.querySelector('textarea').value"), 'Keep this draft')
      await run('window.failSave = false')
      await setText('   ')
      await save()
      assert.deepEqual(await run('window.saved'), ['Revised goal', null])
      assert.equal(await run("document.querySelector('.chat-goal')"), null)
      await run("window.renderGoal({status:'active', objective:'Another goal'})")
      await settle()
      await click('Cancel goal')
      assert.equal(await run("document.querySelector('.chat-goal')"), null)
      for (const status of ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']) {
        await run(`window.renderGoal({status:${JSON.stringify(status)}})`)
        assert.equal(await run("document.querySelector('.chat-goal')"), null)
      }
      await run("window.renderGoal({status:'active', objective:'Build the requested feature'})")
      await settle()
      if (process.env.SELE_GOAL_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_GOAL_SCREENSHOT.replace('.png', '-collapsed.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        await click('Edit goal')
        await run(
          'Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))'
        )
        await fs.writeFile(
          process.env.SELE_GOAL_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      console.log(
        'Goal UI checks passed: edit, save, failed save, empty clear, cancel, inactive removal'
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
