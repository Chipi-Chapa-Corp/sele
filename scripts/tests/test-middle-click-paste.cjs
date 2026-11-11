const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Exercise Chromium's real PRIMARY-selection default action, not synthetic DOM
// events. No renderer paste guard is installed: frames and browser guests must
// inherit the application-wide policy without injecting scripts into pages.
if (!process.versions.electron) {
  ;(async () => {
    if (process.platform !== 'linux') return
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-middle-paste-'))
    try {
      const { build } = require('esbuild')
      await build({
        entryPoints: ['src/main/middleClickPaste.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: path.join(directory, 'policy.cjs')
      })
      await build({
        stdin: {
          contents: `
            import { Terminal } from '@xterm/xterm'
            import '@xterm/xterm/css/xterm.css'
            import { EditorView } from '@codemirror/view'
            import * as monaco from 'monaco-editor/editor/editor.api'
            const terminal = new Terminal({cols: 60, rows: 3})
            terminal.open(document.querySelector('#terminal'))
            window.terminalInput = ''
            terminal.onData(data => window.terminalInput += data)
            const code = new EditorView({parent: document.querySelector('#code')})
            const editor = monaco.editor.create(document.querySelector('#monaco'), {
              value: '', language: 'plaintext', minimap: {enabled: false},
              automaticLayout: true, scrollBeyondLastLine: false
            })
            const shadow = document.querySelector('#shadow').attachShadow({mode: 'closed'})
            shadow.innerHTML = '<input style="width:400px;height:30px">'
            window.shadowInput = shadow.querySelector('input')
            window.readValue = id => id === 'terminal' ? window.terminalInput
              : id === 'code' ? code.state.doc.toString()
              : id === 'monaco' ? editor.getValue()
              : id === 'shadow' ? window.shadowInput.value
              : document.getElementById(id).value ?? document.getElementById(id).textContent
            window.ready = true
          `,
          loader: 'js',
          resolveDir: process.cwd()
        },
        bundle: true,
        platform: 'browser',
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <link rel="stylesheet" href="fixture.css">
        <style>body{margin:10px}input,textarea,[contenteditable],#shadow{display:block;width:500px;height:35px;margin-bottom:8px}
        #terminal,#code,#monaco{width:600px;height:100px;margin-bottom:8px}
        iframe,webview{display:block;width:650px;height:90px;border:0;margin-bottom:8px}</style>
        <input id="input"><textarea id="textarea"></textarea>
        <div id="editable" contenteditable></div><div id="shadow"></div>
        <div id="terminal"></div><div id="code"></div><div id="monaco"></div>
        <a id="link" href="https://example.invalid/" target="_blank">Open link</a>
        <button id="tab">Close tab</button>
        <iframe name="sandbox" sandbox="allow-scripts" src="/frame"></iframe>
        <iframe name="cross-origin"></iframe><webview></webview>
        <script>
          window.closedTabs=0
          document.querySelector('#tab').onauxclick = e => {
            if(e.button===1){e.preventDefault();window.closedTabs++}
          }
          const guestUrl = location.origin.replace('127.0.0.1','localhost')+'/frame'
          document.querySelector('iframe[name="cross-origin"]').src=guestUrl
          document.querySelector('webview').src=guestUrl
        </script><script src="fixture.js"></script>`
      )
      await fs.writeFile(
        path.join(directory, 'frame.html'),
        '<!doctype html><textarea id="textarea" style="width:500px;height:50px"></textarea>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      for (const mode of ['baseline', 'disabled']) {
        const result = require('node:child_process').spawnSync(
          require('electron'),
          [__filename, directory, mode, '--no-sandbox', '--ozone-platform=x11'],
          { env, encoding: 'utf8', timeout: 45000 }
        )
        process.stdout.write(result.stdout || '')
        if (result.status !== 0) throw new Error(result.stderr || String(result.error))
      }
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, clipboard, webContents } = require('electron')
  const directory = process.argv[2]
  const disabled = process.argv[3] === 'disabled'
  app.setPath('userData', path.join(directory, process.argv[3]))
  app.disableHardwareAcceleration()
  // A caller-provided setting must not re-enable primary paste. Other Blink
  // settings must survive application startup.
  app.commandLine.appendSwitch(
    'blink-settings',
    'hideScrollbars=true,selectionClipboardBufferAvailable=true'
  )
  if (disabled) {
    require(path.join(directory, 'policy.cjs')).disableMiddleClickPaste(app.commandLine)
    assert.equal(
      app.commandLine.getSwitchValue('blink-settings'),
      'hideScrollbars=true,selectionClipboardBufferAvailable=false'
    )
  }
  const server = require('node:http').createServer(async (req, res) => {
    try {
      const file =
        req.url === '/frame' ? 'frame.html' : req.url === '/' ? 'index.html' : req.url.slice(1)
      res.setHeader(
        'Content-Type',
        file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'
      )
      res.end(await fs.readFile(path.join(directory, file)))
    } catch {
      res.writeHead(404).end()
    }
  })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
  const waitFor = async (read) => {
    const deadline = Date.now() + 10000
    while (!(await read())) {
      assert.ok(Date.now() < deadline, 'Fixture did not become ready')
      await settle()
    }
  }
  app.whenReady().then(async () => {
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const url = `http://127.0.0.1:${server.address().port}/`
      const win = new BrowserWindow({
        show: true,
        width: 950,
        height: 1200,
        webPreferences: { webviewTag: true, backgroundThrottling: false }
      })
      const contents = win.webContents
      const run = (source) => contents.executeJavaScript(source)
      const click = async (target, selector, offset = { x: 0, y: 0 }) => {
        const point = await target.executeJavaScript(`(() => {
          const node=document.querySelector(${JSON.stringify(selector)})
          if (${Boolean(target.sendInputEvent)}) node.scrollIntoView({block:'center'})
          const r=node.getBoundingClientRect();return {x:r.x+20,y:r.y+15}
        })()`)
        win.focus()
        target.focus?.()
        // Let scrolling reach Chromium's compositor before hit testing input,
        // especially when targeting an out-of-process frame.
        await settle()
        clipboard.writeText('CLIPBOARD_SENTINEL')
        clipboard.writeText('PRIMARY_SENTINEL', 'selection')
        assert.equal(clipboard.readText('selection'), 'PRIMARY_SENTINEL')
        const receiver = target.sendInputEvent ? target : contents
        if (!receiver.debugger.isAttached()) receiver.debugger.attach('1.3')
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
          await receiver.debugger.sendCommand('Input.dispatchMouseEvent', {
            type,
            button: 'middle',
            clickCount: 1,
            x: Math.round(point.x + offset.x),
            y: Math.round(point.y + offset.y)
          })
        }
        await settle()
      }
      const load = async () => {
        await win.loadURL(url)
        await waitFor(() => run('Boolean(window.ready)'))
      }
      await load()
      for (const id of ['input', 'textarea', 'editable', 'shadow', 'terminal', 'code', 'monaco']) {
        await click(contents, id === 'monaco' ? '#monaco .view-lines' : `#${id}`)
        const value = await run(`readValue(${JSON.stringify(id)})`)
        assert.equal(value, disabled ? '' : 'PRIMARY_SENTINEL', `${id}: primary paste`)
      }
      if (disabled) {
        // Keyboard paste still uses the ordinary clipboard.
        await run('document.querySelector("#input").focus()')
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] })
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] })
        await settle()
        assert.equal(await run('readValue("input")'), 'CLIPBOARD_SENTINEL')
        await run('document.querySelector("#terminal .xterm-helper-textarea").focus()')
        contents.paste()
        await settle()
        assert.equal(await run('readValue("terminal")'), 'CLIPBOARD_SENTINEL')

        let openedLinks = 0
        contents.setWindowOpenHandler(() => {
          openedLinks++
          return { action: 'deny' }
        })
        await click(contents, '#link')
        assert.equal(openedLinks, 1, 'Middle-click links still open')
        await click(contents, '#tab')
        assert.equal(await run('window.closedTabs'), 1, 'Middle-click tab actions still run')
      }

      for (const name of ['sandbox', 'cross-origin']) {
        const frame = contents.mainFrame.frames.find((frame) => frame.name === name)
        assert.ok(frame, name)
        const offset = await run(`(() => {
            const node=document.querySelector('iframe[name="${name}"]')
            node.scrollIntoView({block:'center'})
            const r=node.getBoundingClientRect();return {x:r.x,y:r.y}
          })()`)
        await click(frame, '#textarea', offset)
        assert.equal(
          await frame.executeJavaScript('document.querySelector("textarea").value'),
          disabled ? '' : 'PRIMARY_SENTINEL',
          name
        )
      }
      const guest = webContents
        .getAllWebContents()
        .find((content) => content.getType() === 'webview')
      assert.ok(guest)
      await waitFor(() => guest.executeJavaScript('Boolean(document.querySelector("textarea"))'))
      await click(guest, '#textarea')
      assert.equal(
        await guest.executeJavaScript('document.querySelector("textarea").value'),
        disabled ? '' : 'PRIMARY_SENTINEL',
        'Browser tab'
      )
      if (disabled) {
        guest.paste()
        await settle()
        assert.equal(
          await guest.executeJavaScript('document.querySelector("textarea").value'),
          'CLIPBOARD_SENTINEL',
          'Browser tab ordinary paste'
        )
        await new Promise((resolve) => {
          guest.once('did-finish-load', resolve)
          guest.reload()
        })
        await click(guest, '#textarea')
        assert.equal(
          await guest.executeJavaScript('document.querySelector("textarea").value'),
          '',
          'Reloaded browser tab'
        )
        await load()
        await click(contents, '#textarea')
        assert.equal(await run('readValue("textarea")'), '', 'Reloaded app renderer')
      }
      console.log(`Middle-click paste ${disabled ? 'disabled' : 'baseline'} checks passed`)
      server.close()
      app.exit(0)
    } catch (error) {
      console.error(error)
      server.close()
      app.exit(1)
    }
  })
}
