const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Run through the isolated-gui helper. This fixture never starts Sele or Claude.
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-auth-ui-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { ChatDetailItem } from './src/renderer/src/components/ChatDetailItem'
            import './src/renderer/src/assets/styles/tokens.css'
            const root = createRoot(document.getElementById('root'))
            const prompt = { type: 'message', role: 'user', id: 'request', content: 'build me a zip to publish using scripts' }
            const text = 'Failed to authenticate: OAuth session expired and could not be refreshed'
            window.managed = 0
            window.retried = []
            window.renderFailure = (authentication = true, replacementCallback = false) => flushSync(() => root.render(<>
              <ChatDetailItem item={prompt} />
              <ChatDetailItem
                item={{ type: 'working', id: 'request:working', status: 'failed', failureReason: authentication ? 'authentication' : undefined, failureMessage: text, items: [{type: 'message', id: 'auth', content: text}] }}
                retryMessage={prompt}
                onRetryStoppedTurn={message => window.retried.push(message)}
                onManageAccounts={replacementCallback ? () => window.managed += 10 : () => window.managed++}
                progressSettings={{ expandProgressOnStart: false, collapseProgressOnFinish: true }}
              />
            </>))
            window.renderFailure()
          `,
          resolveDir: process.cwd(),
          loader: 'tsx'
        },
        plugins: [
          {
            name: 'unused-editor-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'unused-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
                contents:
                  'export default class { constructor() { throw new Error("Unexpected editor worker") } }',
                loader: 'js'
              }))
            }
          }
        ],
        bundle: true,
        loader: { '.ttf': 'file' },
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'test.js')
      })
      await fs.writeFile(
        path.join(directory, 'test.html'),
        `<!doctype html><html><head>
        <link rel="stylesheet" href="test.css"><style>body{background:var(--background);color:var(--foreground);font:14px system-ui;margin:24px}#root{display:flex;flex-direction:column;gap:12px}</style>
        </head><body><div id="root"></div><script>window.appApi={};window.providerApi=new Proxy({}, {get(){throw new Error('Unexpected provider fetch')}})</script><script src="test.js"></script></body></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        {
          env,
          encoding: 'utf8',
          timeout: 55000
        }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Claude authentication UI checks passed'))
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 850,
      height: 440,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      await win.loadFile(path.join(process.argv[2], 'test.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const state = await run(`({
        assistantCount: document.querySelectorAll('.chat-detail__message--assistant').length,
        failure: document.querySelector('.chat-detail__failure-label')?.textContent,
        failureInsideDetails: !!document.querySelector('.chat-detail__failure-label')?.closest('details'),
        buttons: [...document.querySelectorAll('button')].map(button => button.textContent.trim())
      })`)
      assert.equal(state.assistantCount, 0)
      assert.match(state.failure, /OAuth session expired/)
      assert.match(state.failure, /Sign in again or switch accounts/)
      assert.equal(
        state.failureInsideDetails,
        false,
        'recovery instructions stay visible with progress collapsed'
      )
      assert.ok(state.buttons.includes('Manage accounts'))
      assert.ok(state.buttons.includes('Retry'))
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Manage accounts').click()"
      )
      assert.equal(await run('window.managed'), 1)
      await run('document.querySelector(\'[aria-label="Retry failed turn"]\').click()')
      assert.deepEqual(await run('window.retried.map(message => message.content)'), [
        'build me a zip to publish using scripts'
      ])
      await run('window.renderFailure(true, true)')
      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Manage accounts').click()"
      )
      assert.equal(
        await run('window.managed'),
        11,
        'memoization must forward the latest account callback'
      )
      if (process.env.SELE_AUTH_SCREENSHOT) {
        await run('document.fonts.ready')
        await fs.writeFile(
          process.env.SELE_AUTH_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await run('window.renderFailure(false)')
      assert.equal(
        await run(
          "[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Manage accounts')"
        ),
        false
      )
      assert.doesNotMatch(
        await run('document.body.textContent'),
        /Sign in again or switch accounts/
      )
      console.log('Claude authentication UI checks passed')
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
