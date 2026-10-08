const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-questions-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { UserInputRequestBox } from './src/renderer/src/components/UserInputRequestBox'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/workspace/styles/conversation-requests.css'
            const root = createRoot(document.getElementById('root'))
            window.answers = []
            window.canceled = 0
            window.renderQuestion = (options = {}) => flushSync(() => root.render(
              <UserInputRequestBox key={options.id || 'async'} disabled={options.disabled} error={options.error}
                request={{id: options.id || 'async', question: 'Which saved Freedom24 integration is yours: database ID #1 or #3?', choices: [{label: 'Integration #1', description: null}, {label: 'Integration #3', description: null}], allowFreeform: true, startedAt: 1, isBlocking: false, ...options}}
                onSubmit={(answer, freeform) => window.answers.push({answer, freeform})}
                onCancel={() => window.canceled++} />
            ))
            window.renderQuestion()
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'questions.js')
      })
      await fs.writeFile(
        path.join(directory, 'questions.html'),
        `<!doctype html><html><head><link rel="stylesheet" href="questions.css"><style>body{margin:24px;background:#151515;color:#eee;font:15px system-ui}#root{max-width:700px}</style></head><body><div id="root"></div><script src="questions.js"></script></body></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Codex question UI checks passed'))
        throw new Error(result.stderr || String(result.error || 'UI check failed'))
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
      height: 400,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      await win.loadFile(path.join(process.argv[2], 'questions.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await settle()
      assert.equal(
        await run(`document.querySelectorAll('[aria-label="Answer choices"] button').length`),
        2
      )
      assert.equal(
        await run(
          `document.body.textContent.includes('You can answer while the agent keeps working.')`
        ),
        true
      )
      await fs.writeFile(
        '/tmp/sele-codex-question-preview.png',
        (await win.webContents.capturePage()).toPNG()
      )
      await run(`document.querySelectorAll('[aria-label="Answer choices"] button')[1].click()`)
      assert.deepEqual(await run('window.answers'), [{ answer: 'Integration #3', freeform: false }])
      await run(`(() => {
        const input = document.querySelector('input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Custom account')
        input.dispatchEvent(new Event('input', {bubbles: true}))
      })()`)
      await settle()
      await run(
        `document.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))`
      )
      assert.deepEqual(await run('window.answers.at(-1)'), {
        answer: 'Custom account',
        freeform: true
      })
      await run(`window.renderQuestion({disabled: true})`)
      assert.equal(
        await run(
          `[...document.querySelectorAll('button,input')].every(element => element.disabled)`
        ),
        true
      )
      await run(
        `window.renderQuestion({id: 'secret', isSecret: true, isBlocking: true, choices: [], error: 'Please retry'})`
      )
      assert.equal(await run(`document.querySelector('input').type`), 'password')
      assert.equal(await run(`document.querySelector('input').value`), '')
      assert.equal(
        await run(`document.querySelector('[role="status"]').textContent`),
        'Please retry'
      )
      assert.equal(await run(`document.body.textContent.includes('keeps working')`), false)
      await run(`document.querySelector('[aria-label="Cancel question"]').click()`)
      assert.equal(await run('window.canceled'), 1)
      console.log(
        'Codex question UI checks passed: choices, freeform Enter, disabled state, secret input, errors and cancel'
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
