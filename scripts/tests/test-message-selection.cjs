const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

// Streaming must not detach the DOM nodes that hold the user's selection. When
// it did, Chromium moved the endpoints and copying grabbed unrelated text.
if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-selection-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React, {useRef} from 'react'
            import { createRoot } from 'react-dom/client'
            import { flushSync } from 'react-dom'
            import { MarkdownMessage } from './src/renderer/src/components/ChatDetailItem'
            import {usePatchedHtml} from './src/renderer/src/markdownDomPatch'
            const templateRoot=createRoot(document.getElementById('templates'))
            function PatchedFixture({html,settled}) {
              const ref=useRef(null)
              usePatchedHtml(ref,html,settled)
              return <div ref={ref}/>
            }
            window.mountTemplate=(html,settled,key)=>flushSync(()=>templateRoot.render(
              <React.StrictMode><PatchedFixture key={key} html={html} settled={settled}/></React.StrictMode>))
            const root = createRoot(document.getElementById('root'))
            window.state = { before: 'Earlier answer with stable words.', content: '', streaming: true }
            window.renderFixture = (patch = {}) => {
              Object.assign(window.state, patch)
              const s = window.state
              flushSync(() => root.render(<React.StrictMode>
                <div id="messages">
                  <MarkdownMessage className="chat-detail__message" content={s.before} streaming={false}/>
                  <div id="stream"><MarkdownMessage className="chat-detail__message" content={s.content} streaming={s.streaming}/></div>
                </div>
                <div id="reference" hidden><MarkdownMessage key={s.content} className="chat-detail__message" content={s.content} streaming={false}/></div>
              </React.StrictMode>))
            }
            window.renderFixture()
          `,
          loader: 'tsx',
          resolveDir: path.resolve(__dirname, '../..')
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl', '.css': 'empty' },
        define: { 'process.env.NODE_ENV': '"development"' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'unused-editor-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'unused-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
                contents: 'export default class {}',
                loader: 'js'
              }))
            }
          }
        ]
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html><html><div id="root"></div><div id="templates"></div><script>window.appApi = {}</script><script src="fixture.js"></script></html>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('Selection checks passed')) {
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
    try {
      const errors = []
      const win = new BrowserWindow({
        show: false,
        width: 900,
        height: 700,
        webPreferences: { offscreen: true, backgroundThrottling: false }
      })
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = async (source) => {
        const result = await win.webContents.executeJavaScript(
          `(async () => { try { return { value: await (${source}) } } catch (error) { return { error: String(error?.stack ?? error) } } })()`
        )
        if ('error' in result) throw new Error(result.error)
        return result.value
      }
      await run(`(() => {
        window.markdownRoot = (id) => document.querySelector('#' + id + ' .chat-detail__message-markdown')
        window.findText = (needle) => {
          const walker = document.createTreeWalker(markdownRoot('stream'), NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const offset = node.data.indexOf(needle)
            if (offset >= 0) return { node, offset }
          }
          throw new Error('Missing text ' + needle)
        }
        window.selectStreamText = (startText, endText = startText) => {
          const start = findText(startText)
          const end = findText(endText)
          getSelection().setBaseAndExtent(start.node, start.offset, end.node, end.offset + endText.length)
          return getSelection().toString()
        }
        window.selectFromEarlier = (startText, endText) => {
          const walker = document.createTreeWalker(document.querySelector('#messages .chat-detail__message-markdown'), NodeFilter.SHOW_TEXT)
          let node = walker.nextNode()
          while (node && !node.data.includes(startText)) node = walker.nextNode()
          const end = findText(endText)
          getSelection().setBaseAndExtent(node, node.data.indexOf(startText), end.node, end.offset + endText.length)
          return getSelection().toString()
        }
        window.streamTo = async (content, streaming = true) => {
          renderFixture({ content, streaming })
          const deadline = performance.now() + 5000
          const expected = () => markdownRoot('reference')?.textContent ?? ''
          while (markdownRoot('stream').textContent !== expected()) {
            if (performance.now() > deadline) throw new Error('Stream did not render ' + JSON.stringify(content))
            await new Promise(resolve => setTimeout(resolve, 16))
          }
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        }
        window.renderedHtml = (id) => {
          const clone = markdownRoot(id).cloneNode(true)
          clone.querySelectorAll('[data-stream-reveal]').forEach(span => span.replaceWith(...span.childNodes))
          clone.normalize()
          return clone.innerHTML
        }
      })()`)
      const stream = async (content, streaming = true) => {
        await run(`streamTo(${JSON.stringify(content)}, ${streaming})`)
        assert.equal(await run(`renderedHtml('stream')`), await run(`renderedHtml('reference')`))
      }
      const selection = () => run('getSelection().toString()')

      let content = 'First paragraph alpha.\n\nSecond paragraph beta'
      await stream(content)
      await run('new Promise(resolve => setTimeout(resolve, 500))')

      const settled = await run(`selectStreamText('paragraph alpha')`)
      assert.equal(settled, 'paragraph alpha')
      for (const chunk of [
        ' gamma',
        ' delta',
        '\n\nThird **bo',
        'ld** text',
        '\n\n- item',
        ' one'
      ]) {
        content += chunk
        await stream(content)
        assert.equal(
          await selection(),
          settled,
          `settled block selection after ${JSON.stringify(chunk)}`
        )
      }

      const growing = await run(`selectStreamText('Second paragraph')`)
      for (const chunk of [' epsilon', ' zeta', ' eta']) {
        content = content.replace('beta gamma delta', (value) => value + chunk)
        await stream(content)
        assert.equal(
          await selection(),
          growing,
          `growing block selection after ${JSON.stringify(chunk)}`
        )
      }

      content += '\n\nTail words arrive'
      await stream(content)
      const fresh = await run(`selectStreamText('words arrive')`)
      content += ' quickly'
      await stream(content)
      assert.equal(await selection(), fresh, 'selection inside text that is still fading in')

      const crossing = await run(`selectFromEarlier('stable words', ' text')`)
      assert.match(crossing, /^stable words\.[\s\S]*Third bold text$/)
      for (const chunk of [' and more', '\n\n```js\nconst a = 1', '\n```\n\nDone.']) {
        content += chunk
        await stream(content)
        assert.equal(
          await selection(),
          crossing,
          `cross-message selection after ${JSON.stringify(chunk)}`
        )
      }

      await stream(content, false)
      assert.equal(await selection(), crossing, 'selection after streaming completes')
      const templates = await run(`(() => {
        const property=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
        let parses=0;
        Object.defineProperty(Element.prototype,'innerHTML',{...property,set(value){
          if(this instanceof HTMLTemplateElement)parses++;
          property.set.call(this,value);
        }});
        try {
          const html='<p>Cached **source**</p><img src="data:image/png;base64," alt="original">';
          mountTemplate(html,true,'first');
          const first=document.querySelector('#templates p');
          first.textContent='Mutated live DOM';
          document.querySelector('#templates img').alt='hydrated';
          const firstParses=parses;
          mountTemplate(html,true,'second');
          const cachedParses=parses-firstParses;
          const fresh=document.querySelector('#templates p');
          const result={firstParses,cachedParses,distinct:first!==fresh,text:fresh.textContent,
            alt:document.querySelector('#templates img').alt};
          const beforeStreaming=parses;
          mountTemplate(html,false,'stream-one');
          mountTemplate(html,false,'stream-two');
          result.streamingParses=parses-beforeStreaming;
          mountTemplate('<p>Edited source</p>',true,'edited');
          result.edited=document.querySelector('#templates p').textContent;
          return result;
        } finally {Object.defineProperty(Element.prototype,'innerHTML',property)}
      })()`)
      assert.deepEqual(templates, {
        firstParses: 1,
        cachedParses: 0,
        distinct: true,
        text: 'Cached **source**',
        alt: 'original',
        streamingParses: 2,
        edited: 'Edited source'
      })
      assert.deepEqual(errors, [])
      console.log('Selection checks passed: settled, growing, fading, cross-message, completion')
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      app.exit(code)
    }
  })
}
