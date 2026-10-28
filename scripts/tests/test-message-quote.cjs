const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-quote-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React, {useRef} from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {MessageSelectionQuoteButton} from './src/renderer/src/components/MessageSelectionQuoteButton'
            import './src/renderer/src/assets/main.css'
            import './src/renderer/src/workspace/styles/conversation-messages.css'
            import './src/renderer/src/components/ChatDetailItem.css'
            const root = createRoot(document.getElementById('root'))
            function Fixture() {
              const ref = useRef(null)
              return <main ref={ref}>
                <div className="chat-detail__messages-inner">
                  {Array.from({length: 8}, (_, i) => <div key={i} className="chat-detail__turn" data-chat-turn-id={i}>
                    <div className="chat-detail__message chat-detail__message--assistant">
                      <div className="chat-detail__message-markdown">
                        <p>Название появляется крупно и ненадолго, как часть композиции.</p>
                        <p><strong>0:06–0:14 — первый Маэльстром</strong><br/>
                        На карте затмение закрывает солнечный диск. Вокруг него рисуется вращение.<br/>
                        улицы на мгновение <span data-word={i}>изгибаются</span> от его силы. Число <strong>50</strong> проходит по шкале.</p>
                        <p><strong>0:14–0:22 — Астральные врата и Центральный парк</strong><br/>
                        По карте прорисовывается разлом между мирами.</p>
                      </div>
                      <div className="chat-detail__message-quote-host"/>
                    </div>
                  </div>)}
                </div>
                <textarea aria-label="Composer"/>
                <MessageSelectionQuoteButton containerRef={ref} onQuote={text => window.quoted = text}/>
              </main>
            }
            flushSync(() => root.render(<React.StrictMode><Fixture/></React.StrictMode>))
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
        <html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css">
        <style>:root {font:16px sans-serif; --chat-content-max-width:900px; --chat-content-padding:32px; --lead:#eee}
        body {margin:0; background:#181716} main {height:700px; overflow:auto}</style>
        <div id="root"></div><script src="fixture.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 40000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Quote checks passed')) {
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
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    const win = new BrowserWindow({
      show: true,
      width: 1000,
      height: 750,
      webPreferences: { backgroundThrottling: false }
    })
    const watchdog = setTimeout(() => {
      console.error('Quote selection left the renderer unresponsive')
      app.exit(1)
    }, 25000)
    try {
      const errors = []
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = (source) => win.webContents.executeJavaScript(source)
      const settle = () =>
        run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true
      })
      const click = async (point, clickCount = 1, modifiers = 0) => {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
            type,
            button: 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount,
            modifiers,
            ...point
          })
        }
      }
      await settle()
      for (let i = 0; i < 40; i++) {
        const index = i % 8
        const point = await run(`(() => {
          const word = document.querySelector('[data-word="${index}"]');
          word.scrollIntoView({block:'center'});
          const rect = word.getBoundingClientRect();
          return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
        })()`)
        await click(point)
        await click(point, 2)
        await settle()
        assert.equal(
          await run('getSelection().toString()'),
          'изгибаются',
          'native double click selects the word'
        )
        assert.equal(await run('document.querySelectorAll(".message-selection-quote").length'), 1)
        if (i === 0) {
          const image = await win.webContents.capturePage()
          const artifacts = path.resolve(__dirname, '../../test-results/message-quote')
          await fs.mkdir(artifacts, { recursive: true })
          await fs.writeFile(path.join(artifacts, 'double-click.png'), image.toPNG())
        }
        if (index === 0) {
          assert.equal(
            await run(
              'getComputedStyle(document.querySelector(".chat-detail__turn")).contentVisibility'
            ),
            'auto',
            'showing a quote must preserve containment around the selected text'
          )
        }
      }
      const extension = await run(`(() => {
        const word = document.querySelector('[data-word="7"]');
        const range = document.createRange();
        range.selectNodeContents(word.parentElement.querySelectorAll('strong')[1]);
        const rect = range.getBoundingClientRect();
        return {x:rect.right, y:rect.y + rect.height/2};
      })()`)
      await click(extension, 1, 8)
      await settle()
      assert.match(
        await run('getSelection().toString()'),
        /изгибаются от его силы\. Число 50/,
        'Shift+click extends the native word selection'
      )
      await run(`(() => {
        const text = document.querySelector('[data-word="7"]').firstChild;
        getSelection().setBaseAndExtent(text, 0, text, text.length);
      })()`)
      await settle()
      const point = await run(`(() => {
        const rect = document.querySelector('.message-selection-quote button').getBoundingClientRect();
        return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
      })()`)
      await click(point)
      await settle()
      assert.equal(await run('window.quoted'), 'изгибаются')
      assert.equal(await run('getSelection().isCollapsed'), true)
      const wordPoint = await run(`(() => {
        const rect = document.querySelector('[data-word="7"]').getBoundingClientRect();
        return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
      })()`)
      await click(wordPoint)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        buttons: 1,
        clickCount: 2,
        ...wordPoint
      })
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        button: 'left',
        buttons: 1,
        x: extension.x,
        y: extension.y
      })
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        buttons: 0,
        clickCount: 2,
        x: extension.x,
        y: extension.y
      })
      await settle()
      assert.match(
        await run('getSelection().toString()'),
        /изгибаются от его силы\. Число 50/,
        'double-click and drag extends by words without getting stuck'
      )
      await run(`(() => {
        const history = document.querySelector('.chat-detail__message-markdown');
        const block = '<p>' + '<span>Earlier transcript words </span>'.repeat(40) + '</p>';
        history.insertAdjacentHTML('beforeend', block.repeat(2000));
      })()`)
      for (const index of [0, 7, 0, 7]) {
        const point = await run(`(() => {
          const word = document.querySelector('[data-word="${index}"]');
          word.scrollIntoView({block:'center'});
          const rect = word.getBoundingClientRect();
          return {x:rect.x + rect.width/2, y:rect.y + rect.height/2};
        })()`)
        const start = performance.now()
        await click(point)
        await click(point, 2)
        await settle()
        assert.ok(performance.now() - start < 2000, 'long history selection stays responsive')
        assert.equal(await run('getSelection().toString()'), 'изгибаются')
      }
      await run('document.querySelector("textarea").focus()')
      for (const text of 'still responsive') {
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', text })
      }
      await settle()
      assert.equal(await run('document.querySelector("textarea").value'), 'still responsive')
      assert.equal(await run('document.querySelector(".message-selection-quote")'), null)
      assert.deepEqual(errors, [])
      console.log(
        'Quote checks passed: double clicks, Shift+click, word dragging, quote insertion, long history, composer typing'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      clearTimeout(watchdog)
      app.exit(code)
    }
  })
}
