const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Codex device-code sign-in dialog. Run through the isolated-gui helper.
// This fixture renders only AccountDialog and never starts Sele or Codex.
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-codex-auth-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { AccountDialog } from './src/renderer/src/components/AccountDialog'
            import './src/renderer/src/assets/styles/tokens.css'
            import './src/renderer/src/assets/styles/base.css'
            const root = createRoot(document.getElementById('root'))
            Object.assign(window, { loginCalls: 0, events: [], canceled: 0, closeCount: 0 })
            const startSignIn = async () => {
              window.loginCalls++
              return {
                userCode: 'ABCD-12345',
                completion: new Promise(resolve => { window.finishSignIn = resolve }),
                authorize: async () => { window.events.push('open') },
                copyCode: async () => { window.events.push('code'); await new Promise(resolve => setTimeout(resolve, 150)) },
                copyLink: async () => { window.events.push('link'); await new Promise(resolve => setTimeout(resolve, 150)) },
                cancel: async () => { window.canceled++ }
              }
            }
            root.render(<React.StrictMode>
              <AccountDialog providerLabel="Codex" onLogin={startSignIn} onClose={() => window.closeCount++} />
            </React.StrictMode>)
          `,
          resolveDir: process.cwd(),
          loader: 'tsx'
        },
        bundle: true,
        loader: { '.ttf': 'file' },
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'test.js')
      })
      await fs.writeFile(
        path.join(directory, 'test.html'),
        `<!doctype html><html><head>
        <link rel="stylesheet" href="test.css"><style>body{font:14px system-ui;margin:0}</style>
        </head><body><div id="root"></div><script>
          window.preferencesApi = {
            getItem: () => ({ok:true,value:null}),
            setItem: () => ({ok:true,value:null}),
            removeItem: () => ({ok:true,value:null})
          }
          window.appApi={};window.providerApi={}
        </script><script src="test.js"></script></body></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (
        result.status !== 0 ||
        !result.stdout.includes('Codex device authentication UI checks passed')
      )
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
      width: 750,
      height: 640,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    let code = 0
    try {
      win.webContents.on('console-message', (event) => {
        if (event.level === 'error') console.error('Renderer:', event.message)
      })
      await win.loadFile(path.join(process.argv[2], 'test.html'))
      const run = async (source) => {
        try {
          return await win.webContents.executeJavaScript(source)
        } catch (error) {
          throw new Error(source + ': ' + error.message)
        }
      }
      const frames = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const label = (name) =>
        run(`document.querySelector('[aria-label=${JSON.stringify(name)}]').textContent`)
      await run('new Promise(resolve => setTimeout(resolve, 150))')
      await frames()
      assert.equal(await run('window.loginCalls'), 1, 'StrictMode must start one sign-in flow')

      const initial = await run(`(() => {
        const dialog = document.querySelector('.account-dialog')
        return {
          code: dialog.querySelector('[aria-label="One-time code"]')?.textContent,
          buttons: [...dialog.querySelectorAll('button')].map(button => button.textContent.trim()),
          inputs: dialog.querySelectorAll('input').length,
          text: dialog.textContent
        }
      })()`)
      assert.equal(initial.code, 'ABCD-12345', 'the code stays readable for another device')
      assert.deepEqual(initial.buttons, ['Copy code', 'Open page', 'Copy link', 'Cancel'])
      assert.equal(initial.inputs, 0, 'device-code sign-in needs no pasted code')
      assert.match(initial.text, /another device/)

      const row = await run(`(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect()
        const actions = rect('.account-dialog__browser-actions--device')
        const copy = rect('[aria-label="Copy one-time code"]')
        const open = rect('[aria-label="Open sign-in page"]')
        const link = rect('[aria-label="Copy sign-in link"]')
        return {
          copyFull: Math.abs(copy.width - actions.width) < 1,
          below: open.top >= copy.bottom && link.top >= copy.bottom,
          sameRow: Math.abs(open.top - link.top) < 1
        }
      })()`)
      assert.deepEqual(
        row,
        { copyFull: true, below: true, sameRow: true },
        'Copy code spans the row; Open page and Copy link sit below it'
      )

      await run(`window.dialogBounds = () => {
        const dialog = document.querySelector('.account-dialog')
        const bounds = element => {
          const rect = element.getBoundingClientRect()
          return [rect.x, rect.y, rect.width, rect.height]
        }
        return [bounds(dialog), ...[...dialog.querySelectorAll('button,output')].map(bounds)]
      }; undefined`)
      const initialBounds = await run('window.dialogBounds()')
      await run('document.querySelector(\'[aria-label="Copy one-time code"]\').click()')
      await run('new Promise(resolve => setTimeout(resolve, 220))')
      assert.deepEqual(await run('window.dialogBounds()'), initialBounds, 'copying keeps layout')
      assert.equal(await label('Copy one-time code'), 'Copied')
      assert.equal(await label('Copy sign-in link'), 'Copy link')

      await run('document.querySelector(\'[aria-label="Copy sign-in link"]\').click()')
      await run('new Promise(resolve => setTimeout(resolve, 220))')
      assert.equal(await label('Copy sign-in link'), 'Copied')
      assert.equal(
        await label('Copy one-time code'),
        'Copy code',
        'only the value currently on the clipboard is marked copied'
      )

      await run('document.querySelector(\'[aria-label="Open sign-in page"]\').click()')
      await run('new Promise(resolve => setTimeout(resolve, 50))')
      assert.deepEqual(await run('window.events'), ['code', 'link', 'open'])

      for (const [width, fontSize] of [
        [750, '16px'],
        [360, '16px'],
        [360, '20px']
      ]) {
        win.setSize(width, 640)
        await run(`document.documentElement.style.fontSize = ${JSON.stringify(fontSize)}`)
        await frames()
        assert.equal(
          await run(`(() => {
            const dialog = document.querySelector('.account-dialog')
            const box = dialog.getBoundingClientRect()
            return dialog.scrollWidth <= dialog.clientWidth &&
              [...dialog.querySelectorAll('button,output')].every(element => {
                const rect = element.getBoundingClientRect()
                return rect.left >= box.left && rect.right <= box.right &&
                  rect.top >= box.top && rect.bottom <= box.bottom
              })
          })()`),
          true,
          `all controls fit at ${width}px / ${fontSize}`
        )
        if (process.env.SELE_CODEX_AUTH_SCREENSHOT) {
          await run('document.fonts.ready')
          await fs.writeFile(
            `${process.env.SELE_CODEX_AUTH_SCREENSHOT}-${width}-${fontSize}.png`,
            (await win.webContents.capturePage()).toPNG()
          )
        }
      }

      await run(
        "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Cancel').click()"
      )
      await run('new Promise(resolve => setTimeout(resolve, 80))')
      assert.equal(await run('window.canceled'), 1)
      assert.equal(await run('window.closeCount'), 1)
      console.log('Codex device authentication UI checks passed')
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      win.destroy()
      app.exit(code)
    }
  })
}
