// Production paste hook/IPC callback, synthetic image, disposable profile/private display.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path')
if (!process.versions.electron)
  (async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-paste-'))
    let server
    try {
      const width = 6000,
        height = 4000,
        raw = Buffer.alloc((width * 4 + 1) * height)
      let seed = 12345
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          const p = y * (width * 4 + 1) + 1 + x * 4,
            v = (seed >>> 29) * 36
          raw[p] = v
          raw[p + 1] = v
          raw[p + 2] = v
          raw[p + 3] = 255
        }
      const table = Array.from({ length: 256 }, (_, n) => {
        for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
        return n >>> 0
      })
      const chunk = (type, data) => {
        const t = Buffer.from(type),
          b = Buffer.concat([t, data])
        let crc = 0xffffffff
        for (const x of b) crc = table[(crc ^ x) & 255] ^ (crc >>> 8)
        const head = Buffer.alloc(4),
          tail = Buffer.alloc(4)
        head.writeUInt32BE(data.length)
        tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
        return Buffer.concat([head, b, tail])
      }
      const header = Buffer.alloc(13)
      header.writeUInt32BE(width)
      header.writeUInt32BE(height, 4)
      header[8] = 8
      header[9] = 6
      const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', require('node:zlib').deflateSync(raw, { level: 1 })),
        chunk('IEND', Buffer.alloc(0))
      ])
      assert.ok(png.length < 32 * 1024 * 1024)
      await fs.writeFile(path.join(directory, 'image.png'), png)
      const esbuild = require('esbuild'),
        ts = require('typescript')
      const source = ts.createSourceFile(
        'ipc.ts',
        await fs.readFile('src/main/registerAppIpc.ts', 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      let handler
      const visit = (n) => {
        if (
          ts.isCallExpression(n) &&
          n.arguments[0]?.getText(source) === 'appIpcChannels.getClipboardImage'
        )
          handler = n.arguments[1].getText(source)
        ts.forEachChild(n, visit)
      }
      visit(source)
      assert.ok(handler)
      // The declaration above is returned explicitly after transpilation.
      await fs.writeFile(
        path.join(directory, 'handler.cjs'),
        'module.exports=deps=>{const {clipboard,maxLocalImageBytes,app,join,randomUUID,mkdir,writeFile,persistPastedImage,pastedImages,pastedImageSenders}=deps;' +
          ts.transpileModule('const handler=' + handler, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 }
          }).outputText +
          'return handler;};'
      )
      let popup = ''
      try {
        await fs.access('src/renderer/src/composer/ComposerImageLightbox.tsx')
        popup =
          "import {ComposerImageLightbox} from './src/renderer/src/composer/ComposerImageLightbox';"
      } catch {}
      await esbuild.build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'tsx',
          contents: `
   import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
   import {useComposerAttachments} from './src/renderer/src/composer/useComposerAttachments';
   import {useComposerDraftState} from './src/renderer/src/composer/useComposerDraftState';
   import {ComposerAttachments} from './src/renderer/src/composer/ComposerAttachments';${popup}
   import './src/renderer/src/assets/main.css';import './src/renderer/src/components/MessageBox.css';
   window.gaps=[];window.tasks=[];let before=performance.now();requestAnimationFrame(function frame(now){window.gaps.push(now-before);before=now;requestAnimationFrame(frame)});
   new PerformanceObserver(list=>window.tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});
   const prefs=new Map();window.prefWrites=[];window.preferencesApi={getItem:key=>({ok:true,value:prefs.get(key)??null}),setItem:(key,value)=>{prefs.set(key,value);window.prefWrites.push(value.length);return {ok:true,value:null}},removeItem:key=>{prefs.delete(key);return {ok:true,value:null}}};
   const noop=()=>{};function Fixture(){const ref=useRef(null),edit=useRef(null);const draft=useComposerDraftState({editSession:null,draftScopeKey:'fixture'});const [error,setError]=useState(null);
    const attachments=useComposerAttachments({options:{},draft,linked:{handleLinkChat:noop},setAttachmentSelectionError:setError,editSessionIdRef:edit,textareaRef:ref});
    window.fixture={error,pending:attachments.attachmentSelectionPending,image:draft.selectedAttachments[0],text:draft.message};
    return <div style={{padding:30}}><textarea id="input" ref={ref} value={draft.message} onChange={e=>draft.setMessage(e.target.value)} onPaste={e=>void attachments.handlePaste(e)}/>
    <ComposerAttachments selectedAttachments={draft.selectedAttachments} linkedChats={[]} selectedSkills={[]} selectedApps={[]} selectedQuotes={[]} handleChangeQuote={noop} handleRemoveQuote={noop} handleOpenAttachment={attachments.handleOpenAttachment} handleRemoveAttachment={attachments.handleRemoveAttachment} handleRemoveLinkedChat={noop} providerId="codex" textareaRef={ref} handleRemoveSkill={noop} handleRemoveApp={noop} selectedReview={null} editing={false}/>
    ${popup ? '<>{attachments.openedImage&&<ComposerImageLightbox image={attachments.openedImage} tool={attachments.annotationTool} onToolChange={attachments.setAnnotationTool} onSave={attachments.handleSaveOpenedImage} onClose={()=>attachments.setOpenedImage(null)}/>}</>' : ''}{error&&<p role="alert">{error}</p>}</div>}
   createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
   window.prepare=async()=>{const blob=await (await fetch('/image.png')).blob();window.pastedFile=new File([blob],'clipboard.png',{type:'image/png'})};
   window.paste=()=>{window.gaps=[];window.tasks=[];const data=new DataTransfer();data.items.add(window.pastedFile);document.querySelector('#input').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));};
  `
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"development"' },
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [require('./helpers/pasted-image-worker.cjs')(directory)]
      })
      try {
        await fs.access('src/main/pastedImages.ts')
        await esbuild.build({
          entryPoints: ['src/main/pastedImages.ts'],
          bundle: true,
          platform: 'node',
          format: 'cjs',
          outfile: path.join(directory, 'pasted.cjs')
        })
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('appApi',{getClipboardImage:value=>ipcRenderer.invoke('paste',value),getLocalImage:options=>ipcRenderer.invoke('read-image',options.path)});`
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'
      )
      server = require('node:http').createServer(async (req, res) => {
        try {
          const file = path.basename(req.url) === '' ? 'index.html' : path.basename(req.url)
          res.setHeader(
            'Content-Type',
            file.endsWith('.js')
              ? 'text/javascript'
              : file.endsWith('.css')
                ? 'text/css'
                : file.endsWith('.png')
                  ? 'image/png'
                  : 'text/html'
          )
          res.end(await fs.readFile(path.join(directory, file)))
        } catch {
          res.statusCode = 404
          res.end()
        }
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = require('node:child_process').spawn(
        require('electron'),
        [__filename, directory, 'http://127.0.0.1:' + server.address().port, '--no-sandbox'],
        { env, stdio: 'inherit' }
      )
      const code = await new Promise((resolve) => child.once('exit', resolve))
      assert.equal(code, 0)
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve))
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
else {
  const { app, BrowserWindow, ipcMain, clipboard, nativeImage } = require('electron'),
    directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    try {
      const input = await fs.readFile(path.join(directory, 'image.png'))
      clipboard.writeImage(nativeImage.createFromBuffer(input))
      let nativeReads = 0,
        mainGap = 0,
        last = performance.now()
      const beat = setInterval(() => {
        const now = performance.now()
        mainGap = Math.max(mainGap, now - last)
        last = now
      }, 5)
      const handler = require(path.join(directory, 'handler.cjs'))({
        clipboard: {
          readImage: () => {
            nativeReads++
            return clipboard.readImage()
          }
        },
        maxLocalImageBytes: 32 * 1024 * 1024,
        app,
        join: path.join,
        randomUUID: require('node:crypto').randomUUID,
        mkdir: fs.mkdir,
        writeFile: fs.writeFile,
        pastedImages: require('node:fs').existsSync(path.join(directory, 'pasted.cjs'))
          ? new (require(path.join(directory, 'pasted.cjs')).PastedImageStore)(
              path.join(app.getPath('userData'), 'sele-message-images')
            )
          : undefined,
        pastedImageSenders: new Set()
      })
      ipcMain.handle('paste', handler)
      ipcMain.handle('read-image', async (_event, file) => ({
        data: Uint8Array.from(await fs.readFile(file)).buffer,
        mimeType: 'image/png',
        updatedAt: 0
      }))
      const win = new BrowserWindow({
        show: true,
        width: 1000,
        height: 800,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          backgroundThrottling: false
        }
      })
      const errors = []
      win.webContents.on('console-message', (e) => {
        if (e.level === 'error') errors.push(e.message)
      })
      const run = (s) => win.webContents.executeJavaScript(s)
      const wait = async (s) => {
        const end = Date.now() + 20000
        while (!(await run(s))) {
          if (Date.now() > end) throw Error('Timed out: ' + s + '; ' + errors.join('\n'))
          await new Promise((r) => setTimeout(r, 20))
        }
      }
      await win.loadURL(process.argv[3])
      await wait('Boolean(window.fixture)')
      await run('prepare()')
      await new Promise((r) => setTimeout(r, 300))
      await run('document.querySelector("#input").focus()')
      // The captured paste must remain correct if the system clipboard changes.
      if (process.env.SELE_PASTE_MEASURE_ONLY !== '1')
        clipboard.writeText('Changed after file capture')
      mainGap = 0
      last = performance.now()
      if (process.env.SELE_PASTE_PROFILE) {
        win.webContents.debugger.attach('1.3')
        await win.webContents.debugger.sendCommand('Performance.enable')
        await win.webContents.debugger.sendCommand('Profiler.enable')
        await win.webContents.debugger.sendCommand('Profiler.setSamplingInterval', {
          interval: 500
        })
        await win.webContents.debugger.sendCommand('Profiler.start')
      }
      const start = performance.now()
      await run('paste()')
      const type = setInterval(
        () => win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' }),
        30
      )
      await wait('!fixture.pending && (fixture.image || fixture.error)')
      clearInterval(type)
      await new Promise((r) => setTimeout(r, 500))
      const result = await run(
        `({error:fixture.error,text:fixture.text,previewBytes:fixture.image?.dataUrl.length,previewOnly:fixture.image?.previewOnly??false,path:fixture.image?.path,maxFrameGap:Math.max(...gaps),tasks,preferenceWriteBytes:Math.max(0,...prefWrites)})`
      )
      clearInterval(beat)
      if (process.env.SELE_PASTE_PROFILE) {
        const { profile } = await win.webContents.debugger.sendCommand('Profiler.stop')
        const { metrics } = await win.webContents.debugger.sendCommand('Performance.getMetrics')
        await fs.writeFile(process.env.SELE_PASTE_PROFILE, JSON.stringify(profile))
        await fs.writeFile(
          process.env.SELE_PASTE_PROFILE + '.json',
          JSON.stringify({
            navigationStart: metrics.find((x) => x.name === 'NavigationStart').value,
            tasks: result.tasks
          })
        )
      }
      result.totalMs = performance.now() - start
      result.mainGap = mainGap
      result.nativeReads = nativeReads
      result.originalBytes = input.length
      assert.equal(result.error, null)
      assert.ok(result.text.length > 0)
      const saved = await fs.readFile(result.path)
      if (process.env.SELE_PASTE_MEASURE_ONLY !== '1')
        assert.ok(saved.equals(input), 'preserve original encoded image bytes')
      if (process.env.SELE_PASTE_MEASURE_ONLY !== '1') {
        assert.equal(nativeReads, 0, 'image paste must not reread/reencode the native clipboard')
        assert.ok(result.previewBytes < 131072)
        assert.ok(result.preferenceWriteBytes < 131072)
        assert.equal(result.previewOnly, true)
        assert.deepEqual(result.tasks, [], 'large paste must not block the renderer for 50 ms')
        assert.ok(mainGap < 150, JSON.stringify(result))
        await run('document.querySelector(".message-box__attachment-open").click()')
        await wait(
          'document.querySelector(".image-lightbox img")?.naturalWidth===6000 && document.querySelector(".image-lightbox img")?.naturalHeight===4000'
        )
      }
      assert.deepEqual(errors, [])
      delete result.path
      delete result.text
      console.log(JSON.stringify(result, null, 2))
    } catch (e) {
      console.error(e)
      code = 1
    } finally {
      app.exit(code)
    }
  })
}
