/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Node/Electron test harness. */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-input-focus-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { Input } from './src/renderer/src/components/Input'
            import { BranchSwitcher } from './src/renderer/src/components/BranchSwitcher'
            import { MessageSelectionQuoteButton } from './src/renderer/src/components/MessageSelectionQuoteButton'
            const root = createRoot(document.getElementById('root'))
            window.inputRef = React.createRef()
            window.renderInput = (options = {}) => flushSync(() => root.render(<React.StrictMode>
              <MessageSelectionQuoteButton containerRef={{ current: document.body }} onQuote={() => {}} />
              <Input key={JSON.stringify(options)} ref={window.inputRef} id="input"
                type={options.type || 'text'} autoFocus={options.autoFocus}
                defaultValue="hello" onFocus={event => {
                  if (options.select) event.currentTarget.select()
                }} />
              <button id="other">Other</button>
            </React.StrictMode>))
            window.renderBranches = () => flushSync(() => root.render(<React.StrictMode>
              <MessageSelectionQuoteButton containerRef={{ current: document.body }} onQuote={() => {}} />
              <BranchSwitcher id="branches" branches={['main', 'feature']} currentBranch="main"
                onSwitch={async () => true} onDelete={async () => {}} />
            </React.StrictMode>))
            window.renderInput()
          `,
          resolveDir: path.resolve(__dirname, '..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'input.js')
      })
      await fs.writeFile(
        path.join(directory, 'input.html'),
        '<!doctype html><link rel="stylesheet" href="input.css"><div id="root"></div><script src="input.js"></script>'
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
        !result.stdout.includes('Input focus checks passed:')
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
      await window.loadFile(path.join(process.argv[2], 'input.html'))
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true
      })
      const typeText = (text) =>
        window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text })
      const run = (source) =>
        window.webContents.executeJavaScript(source).catch((error) => {
          throw new Error(source, { cause: error })
        })
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      // Keep the real quote-selection listener mounted: it clears ranges on focusin.
      await settle()
      await run('window.renderBranches()')
      await settle()
      const trigger = await run(`(() => {
        const rect = document.getElementById('branches').getBoundingClientRect()
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
      })()`)
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...trigger
      })
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        ...trigger
      })
      await settle()
      assert.equal(
        await run('document.activeElement.getAttribute("aria-label")'),
        'Search branches'
      )
      assert.equal(
        await run('window.getSelection().rangeCount'),
        1,
        'branch search has an editing caret'
      )
      await typeText('f')
      await settle()
      assert.equal(
        await run("document.querySelector('input').value"),
        'f',
        'branch search accepts typing after opening'
      )
      await run('document.getElementById("branches").click()')
      await settle()
      await run('document.getElementById("branches").click()')
      await settle()
      await typeText('m')
      await settle()
      assert.equal(
        await run("document.querySelector('input').value"),
        'm',
        'branch search accepts typing after reopening'
      )
      for (const type of ['text', 'search']) {
        for (const autoFocus of [false, true]) {
          await run(`window.renderInput(${JSON.stringify({ type, autoFocus })})`)
          if (!autoFocus) await run('window.inputRef.current.focus()')
          await settle()
          assert.equal(await run('document.activeElement.id'), 'input')
          assert.equal(await run('window.getSelection().rangeCount'), 1, 'editing caret exists')
          const before = await run('window.inputRef.current.selectionStart')
          await typeText('x')
          await settle()
          assert.equal(
            await run('window.inputRef.current.value'),
            'hello'.slice(0, before) + 'x' + 'hello'.slice(before),
            `${type} accepts typing after ${autoFocus ? 'autofocus' : 'ref.focus()'}`
          )
        }
      }
      await run('window.renderInput({ select: true }); window.inputRef.current.focus()')
      await settle()
      assert.deepEqual(
        await run('[window.inputRef.current.selectionStart, window.inputRef.current.selectionEnd]'),
        [0, 5],
        'consumer onFocus selection survives'
      )
      await run(
        'document.getElementById("other").focus(); window.inputRef.current.focus(); document.getElementById("other").focus()'
      )
      await settle()
      assert.equal(await run('document.activeElement.id'), 'other', 'retry does not steal focus')
      // Unsupported selection APIs must not throw for non-text input types.
      await run('window.renderInput({ type: "number", autoFocus: true })')
      await settle()
      assert.equal(await run('document.activeElement.id'), 'input')
      await run('window.renderInput(); window.inputRef.current.focus(); window.renderBranches()')
      await settle()
      assert.equal(
        await run('document.activeElement.tagName'),
        'BODY',
        'detached input does not regain focus'
      )
      console.log(
        'Input focus checks passed: branch opening/reopening, Strict Mode, caret, typing, autofocus, selection, and focus transfer.'
      )
    } catch (error) {
      console.error(error)
      exitCode = 1
    } finally {
      window.destroy()
      app.exit(exitCode)
    }
  })
}
