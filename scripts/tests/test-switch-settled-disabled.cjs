// Controls must not flash disabled while a chat or project switch settles.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-switch-settled-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { useSwitchSettledDisabled } from './src/renderer/src/useSwitchSettledDisabled'
            const Probe = ({ disabled, switchKey }) => (
              <button id="probe" disabled={useSwitchSettledDisabled(disabled, switchKey)}>Send</button>
            )
            const root = createRoot(document.getElementById('root'))
            window.renderProbe = (disabled, switchKey) =>
              flushSync(() => root.render(<React.StrictMode><Probe disabled={disabled} switchKey={switchKey} /></React.StrictMode>))
            window.isDisabled = () => document.getElementById('probe').disabled
            window.changes = []
            new MutationObserver(records => {
              for (const record of records) {
                window.changes.push(record.target.hasAttribute('disabled') ? 'disabled' : 'enabled')
              }
            }).observe(document.getElementById('root'), { subtree: true, attributes: true, attributeFilter: ['disabled'] })
            window.wait = ms => new Promise(resolve => setTimeout(resolve, ms))
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        outfile: path.join(directory, 'probe.js')
      })
      await fs.writeFile(
        path.join(directory, 'probe.html'),
        '<!doctype html><div id="root"></div><script src="probe.js"></script>'
      )
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env: environment, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (
        result.status !== 0 ||
        result.error ||
        !result.stdout.includes('Switch settle checks passed')
      ) {
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
    const window = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false, offscreen: true }
    })
    let exitCode = 0
    try {
      await window.loadFile(path.join(process.argv[2], 'probe.html'))
      const run = (source) => window.webContents.executeJavaScript(source)
      const reset = () => run('window.changes = []')

      await run('window.renderProbe(false, "a")')
      await reset()
      // A check that is unresolved only while the next chat loads never paints as disabled.
      await run('window.renderProbe(true, "b")')
      assert.equal(await run('window.isDisabled()'), false)
      await run('window.wait(120)')
      await run('window.renderProbe(false, "b")')
      await run('window.wait(300)')
      assert.deepEqual(await run('window.changes'), [], 'a settled switch must not flicker')

      // A check that stays blocked after the switch disables once, after the hold.
      await run('window.renderProbe(true, "c")')
      await run('window.wait(150)')
      assert.equal(await run('window.isDisabled()'), false, 'held during the switch')
      await run('window.wait(250)')
      assert.equal(await run('window.isDisabled()'), true, 'applied after the switch settles')
      assert.deepEqual(await run('window.changes'), ['disabled'])

      // A control that was already disabled stays disabled through a switch.
      await reset()
      await run('window.renderProbe(true, "d")')
      await run('window.wait(150)')
      await run('window.renderProbe(false, "d")')
      assert.deepEqual(await run('window.changes'), ['enabled'], 'enabling is immediate')

      // Outside a switch, disabling applies immediately.
      await reset()
      await run('window.renderProbe(true, "d")')
      await run('window.wait(400)')
      await run('window.renderProbe(false, "d")')
      await run('window.renderProbe(true, "d")')
      assert.equal(await run('window.isDisabled()'), true)
      assert.deepEqual(await run('window.changes'), ['disabled', 'enabled', 'disabled'])

      // Rapid switches keep the state shown before the first one.
      await run('window.renderProbe(false, "e")')
      await run('window.wait(400)')
      await reset()
      await run('window.renderProbe(true, "f")')
      await run('window.wait(100)')
      await run('window.renderProbe(true, "g")')
      await run('window.wait(150)')
      await run('window.renderProbe(false, "g")')
      await run('window.wait(300)')
      assert.deepEqual(await run('window.changes'), [], 'rapid switches must not flicker')

      console.log('Switch settle checks passed')
    } catch (error) {
      console.error(error)
      exitCode = 1
    } finally {
      window.destroy()
      app.exit(exitCode)
    }
  })
}
