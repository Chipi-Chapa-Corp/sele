// Real composer/editor + image persistence in a disposable Electron profile.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-annotations-'))
    let server
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'tsx',
          contents: `
          import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
          import {useComposerAttachments} from './src/renderer/src/composer/useComposerAttachments';
          import {ComposerImageLightbox} from './src/renderer/src/composer/ComposerImageLightbox';
          import './src/renderer/src/assets/main.css';
          function Fixture({initial}) {
            const [selectedAttachments,setSelectedAttachments]=useState([initial]);const ref=useRef(null),edit=useRef(null);
            const a=useComposerAttachments({options:{},draft:{selectedAttachments,setSelectedAttachments,setSelectedSkills:()=>{},setSelectedApps:()=>{}},linked:{handleLinkChat:()=>{}},setAttachmentSelectionError:()=>{},editSessionIdRef:edit,textareaRef:ref});
            window.fixture={image:selectedAttachments[0],images:selectedAttachments,replace:image=>setSelectedAttachments([image]),addImage:async()=>{const image=await window.appApi.fixtureImage('second');setSelectedAttachments(current=>[...current,{kind:'file',name:'notes.txt',path:'/notes.txt'},image])},open:(index=0)=>a.handleOpenAttachment(selectedAttachments[index])};
            return <><textarea ref={ref}/><button id="open" onClick={()=>a.handleOpenAttachment(selectedAttachments[0])}>Open</button>{a.openedImage&&<ComposerImageLightbox key={a.openedImage.path} image={a.openedImage} tool={a.annotationTool} onToolChange={a.setAnnotationTool} position={a.openedImagePosition} count={a.imageCount} annotationStartNumber={a.annotationStartNumber} onPrevious={a.handlePreviousImage} onNext={a.handleNextImage} onSave={a.handleSaveOpenedImage} onClose={()=>a.setOpenedImage(null)}/>}</>
          }
          window.appApi.fixtureImage().then(initial=>createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture initial={initial}/></React.StrictMode>));`
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"development"' },
        loader: { '.ttf': 'dataurl' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [require('./helpers/pasted-image-worker.cjs')(directory)]
      })
      await require('esbuild').build({
        entryPoints: ['src/main/pastedImages.ts'],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: path.join(directory, 'store.cjs')
      })
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('appApi',Object.fromEntries(['fixtureImage','getClipboardImage','getLocalImage','writeClipboardImage','saveLocalImage'].map(name=>[name,value=>ipcRenderer.invoke(name,value)])));`
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'
      )
      server = require('node:http').createServer(async (req, res) => {
        try {
          const name = path.basename(req.url) || 'index.html'
          res.setHeader(
            'Content-Type',
            name.endsWith('.js')
              ? 'text/javascript'
              : name.endsWith('.css')
                ? 'text/css'
                : 'text/html'
          )
          res.end(await fs.readFile(path.join(directory, name)))
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
      assert.equal(await new Promise((resolve) => child.once('exit', resolve)), 0)
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve))
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    try {
      const original = path.join(directory, 'original.png')
      const bytes = nativeImage
        .createFromBitmap(Buffer.alloc(800 * 500 * 4, 255), { width: 800, height: 500 })
        .toPNG()
      await fs.writeFile(original, bytes)
      const second = path.join(directory, 'second.png')
      await fs.writeFile(second, bytes)
      const largePath = path.join(directory, 'large.png')
      const width = 6000,
        height = 4000
      const pixels = Buffer.alloc(width * height * 4)
      let seed = 12345
      for (let offset = 0; offset < pixels.length; offset += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = (seed >>> 29) * 36
        pixels[offset + 3] = 255
      }
      await fs.writeFile(largePath, nativeImage.createFromBitmap(pixels, { width, height }).toPNG())
      const store = new (require(path.join(directory, 'store.cjs')).PastedImageStore)(
        path.join(directory, 'images')
      )
      let copied,
        fail = false
      ipcMain.handle('fixtureImage', async (_, large) => ({
        kind: 'image',
        name: 'original.png',
        path: large === 'second' ? second : large ? largePath : original,
        previewOnly: Boolean(large) && large !== 'inline' && large !== 'second',
        dataUrl:
          'data:image/png;base64,' +
          (large === 'inline' ? await fs.readFile(largePath) : bytes).toString('base64')
      }))
      ipcMain.handle('getClipboardImage', (event, value) => {
        if (fail) throw Error('Fixture save failed')
        return store.write(value, event.sender.id)
      })
      ipcMain.handle('getLocalImage', async (_, options) => ({
        data: Uint8Array.from(await fs.readFile(options.path)).buffer,
        mimeType: 'image/png',
        updatedAt: 0
      }))
      ipcMain.handle('writeClipboardImage', (_, data) => {
        copied = Buffer.from(data)
      })
      ipcMain.handle('saveLocalImage', async (_, options) => {
        const output = path.join(directory, 'download.png')
        await fs.copyFile(options.path, output)
        return output
      })
      const win = new BrowserWindow({
        show: true,
        width: 1100,
        height: 800,
        webPreferences: {
          preload: path.join(directory, 'preload.cjs'),
          backgroundThrottling: false
        }
      })
      const errors = []
      win.webContents.on('console-message', (e) => {
        if (e.level === 'error' && !e.message.includes('Fixture save failed'))
          errors.push(e.message)
      })
      const run = (source) => win.webContents.executeJavaScript(source)
      const pause = () => new Promise((resolve) => setTimeout(resolve, 35))
      const wait = async (source) => {
        const end = Date.now() + 15000
        while (!(await run(source))) {
          if (Date.now() > end) throw Error('Timed out: ' + source + '; ' + errors.join('\n'))
          await pause()
        }
      }
      const click = async (label) => {
        await run(`document.querySelector('[aria-label="${label}"]').click()`)
        await pause()
      }
      const selectedTool = () =>
        run(
          'document.querySelector(".image-lightbox__tools [aria-pressed=true]")?.getAttribute("aria-label") ?? null'
        )
      const open = async () => {
        await run('fixture.open()')
        await wait('Boolean(document.querySelector(".image-annotations"))')
        await pause()
      }
      const drawPath = async (points, button = 'left', modifiers = []) => {
        const rect = await run(
          '(()=>{const r=document.querySelector(".image-annotations").getBoundingClientRect();return {x:r.x,y:r.y}})()'
        )
        win.webContents.sendInputEvent({
          type: 'mouseDown',
          modifiers,
          x: Math.round(rect.x + points[0][0]),
          y: Math.round(rect.y + points[0][1]),
          button,
          clickCount: 1
        })
        for (const [x, y] of points.slice(1)) {
          win.webContents.sendInputEvent({
            type: 'mouseMove',
            modifiers,
            x: Math.round(rect.x + x),
            y: Math.round(rect.y + y),
            button
          })
          await pause()
        }
        win.webContents.sendInputEvent({
          type: 'mouseUp',
          modifiers,
          x: Math.round(rect.x + points[points.length - 1][0]),
          y: Math.round(rect.y + points[points.length - 1][1]),
          button,
          clickCount: 1
        })
        await pause()
      }
      const draw = (x1, y1, x2, y2, button = 'left') =>
        drawPath([[x1, y1], ...(x2 === undefined ? [] : [[x2, y2]])], button)
      const labels = () =>
        run('[...document.querySelectorAll(".image-annotations text")].map(n=>n.textContent)')
      const groups = () => run('document.querySelectorAll(".image-annotations > g").length')
      const assertToolbar = async () => {
        assert.ok(
          await run(
            `(()=>{const image=document.querySelector('.image-lightbox img').getBoundingClientRect();return [...document.querySelectorAll('.image-lightbox__toolbar button')].every(button=>{const r=button.getBoundingClientRect();return r.bottom<image.top&&r.top>=0&&r.left>=0&&r.right<=innerWidth})})()`
          ),
          'annotation tools and image actions stay above the image and within the viewport'
        )
      }
      const redPixels = (png) => {
        const image = nativeImage.createFromBuffer(png)
        assert.deepEqual(image.getSize(), { width: 800, height: 500 })
        const bitmap = image.toBitmap()
        let red = 0
        for (let i = 0; i < bitmap.length; i += 4)
          if (bitmap[i + 2] > 200 && bitmap[i] < 80 && bitmap[i + 1] < 80) red++
        return red
      }
      await win.loadURL(process.argv[3])
      await wait('Boolean(window.fixture)')
      await open()
      await assertToolbar()
      await draw(200, 200, 300, 300)
      assert.equal(await groups(), 0, 'no active tool draws nothing')
      assert.equal(
        await run(
          'document.querySelector(".image-lightbox__tools button").getAttribute("aria-label")'
        ),
        'Draw with brush'
      )
      await click('Draw with brush')
      await drawPath([
        [100, 300],
        [150, 350],
        [200, 350],
        [250, 300]
      ])
      assert.equal(await groups(), 1)
      assert.equal(
        await run('document.querySelectorAll(".image-annotations > g path").length'),
        1,
        'brush has no arrowhead'
      )
      assert.ok(
        await run(
          '(()=>{const p=document.querySelector(".image-annotations path");return p.getPointAtLength(p.getTotalLength()/2).y>320})()'
        ),
        'brush follows the curved drag'
      )
      assert.deepEqual(await labels(), [], 'brush does not consume a number')
      await draw(100, 100)
      assert.equal(await groups(), 2, 'brush click creates a dot')
      await click('Undo annotation')
      await click('Undo annotation')
      assert.equal(await groups(), 0)
      await click('Draw with brush')
      assert.equal(
        await run(
          'document.querySelector("[aria-label=\'Draw with brush\']").getAttribute("aria-pressed")'
        ),
        'false'
      )
      await click('Draw arrows')
      await draw(150, 150, 350, 230)
      assert.equal(await groups(), 1)
      assert.deepEqual(await labels(), [])
      await click('Draw arrows')
      assert.equal(
        await run(
          'document.querySelector("[aria-label=\'Draw arrows\']").getAttribute("aria-pressed")'
        ),
        'false'
      )
      await draw(300, 300)
      assert.equal(await groups(), 1)
      await click('Draw numbered arrows')
      await draw(400, 160, 600, 230)
      assert.deepEqual(await labels(), ['1'])
      await click('Draw numbers')
      assert.equal(
        await run('document.querySelectorAll(".image-lightbox__tools [aria-pressed=true]").length'),
        1
      )
      await draw(300, 350)
      assert.deepEqual(await labels(), ['1', '2'])
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: ['control'] })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers: ['control'] })
      await pause()
      assert.deepEqual(await labels(), ['1'])
      await draw(300, 350)
      assert.deepEqual(await labels(), ['1', '2'])
      await click('Undo annotation')
      assert.deepEqual(await labels(), ['1'])
      await run(
        'document.querySelector(".image-annotations").dispatchEvent(new WheelEvent("wheel",{deltaY:-100,bubbles:true,cancelable:true}))'
      )
      await pause()
      assert.equal(await run('document.querySelector(".image-annotations").dataset.thickness'), '4')
      await draw(500, 350)
      assert.deepEqual(await labels(), ['1', '2'])
      assert.ok(
        await run(
          'Number(document.querySelectorAll(".image-annotations text")[1].getAttribute("font-weight")) > Number(document.querySelectorAll(".image-annotations text")[0].getAttribute("font-weight"))'
        )
      )
      await draw(600, 350, undefined, undefined, 'right')
      assert.equal(await groups(), 3, 'right click does not draw')
      await click('Draw numbered arrows')
      await draw(600, 350)
      assert.equal(await groups(), 3, 'a zero length drag does not consume a number')
      await click('Draw arrows')
      await draw(200, 350, 400, 350)
      assert.equal(
        await run(
          'Number(document.querySelectorAll(".image-annotations > g")[3].getAttribute("stroke-width"))'
        ),
        4
      )
      await click('Undo annotation')
      await click('Draw with brush')
      await drawPath([
        [100, 400],
        [150, 450],
        [200, 450],
        [250, 400]
      ])
      await draw(100, 100)
      await click('Draw arrows')
      await drawPath([
        [400, 400],
        [450, 450],
        [500, 450],
        [550, 400]
      ])
      assert.ok(
        await run(
          '(()=>{const p=document.querySelectorAll(".image-annotations > g")[5].querySelector("path");return p.getPointAtLength(p.getTotalLength()/2).y>420})()'
        ),
        'arrow follows the curved drag'
      )
      assert.ok(
        await run(
          'document.querySelectorAll(".image-annotations > g")[5].querySelectorAll("path")[1].getAttribute("d").startsWith("M 550 400 ")'
        ),
        'arrowhead lands at the release position'
      )
      await click('Draw numbered arrows')
      await drawPath([
        [650, 300],
        [700, 350],
        [750, 300],
        [700, 250],
        [650, 300]
      ])
      assert.deepEqual(
        await labels(),
        ['1', '2', '3'],
        'a looped numbered arrow is kept even when its endpoints coincide'
      )
      await click('Undo annotation')
      await click('Draw numbers')
      await draw(650, 250)
      assert.deepEqual(
        await labels(),
        ['1', '2', '3'],
        'undo restores numbering after a freehand arrow'
      )
      await click('Undo annotation')
      const lastPathMidY = () =>
        run(
          '(()=>{const p=document.querySelector(".image-annotations > g:last-child path");return p.getPointAtLength(p.getTotalLength()/2).y})()'
        )
      for (const label of ['Draw arrows', 'Draw numbered arrows']) {
        await click(label)
        await drawPath(
          [
            [600, 50],
            [650, 150],
            [700, 50]
          ],
          'left',
          ['shift']
        )
        assert.ok(Math.abs((await lastPathMidY()) - 50) < 0.01, 'Shift constrains ' + label)
        await click('Undo annotation')
      }
      await click('Draw arrows')
      const rect = await run(
        '(()=>{const r=document.querySelector(".image-annotations").getBoundingClientRect();return {x:r.x,y:r.y}})()'
      )
      const pointer = (type, x, y, modifiers = []) =>
        win.webContents.sendInputEvent({
          type,
          x: Math.round(rect.x + x),
          y: Math.round(rect.y + y),
          button: 'left',
          clickCount: 1,
          modifiers
        })
      try {
        pointer('mouseDown', 600, 100)
        pointer('mouseMove', 650, 200)
        await pause()
        pointer('mouseMove', 700, 100)
        await pause()
        assert.ok((await lastPathMidY()) > 120, 'arrow starts freehand')
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Shift', modifiers: ['shift'] })
        await pause()
        assert.ok(
          Math.abs((await lastPathMidY()) - 100) < 0.01,
          'pressing Shift straightens the preview without moving'
        )
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift' })
        await pause()
        assert.ok(
          (await lastPathMidY()) > 120,
          'releasing Shift restores the original freehand preview'
        )
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Shift', modifiers: ['shift'] })
        await pause()
        pointer('mouseUp', 700, 100, ['shift'])
        await pause()
        assert.ok(
          Math.abs((await lastPathMidY()) - 100) < 0.01,
          'release commits the straight arrow'
        )
      } finally {
        pointer('mouseUp', 700, 100)
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift' })
      }
      await run(
        'document.querySelector(".image-lightbox__frame").style.cssText="width:500px;height:300px"'
      )
      await pause()
      assert.ok(
        await run(
          '(()=>{const r=document.querySelector(".image-annotations").getBoundingClientRect();return Math.abs(r.width/r.height-1.6)<0.01})()'
        ),
        'resize preserves annotation coordinates'
      )
      await run('document.querySelector(".image-lightbox__frame").style.cssText=""')
      await pause()
      if (process.env.SELE_IMAGE_EDITOR_SCREENSHOT) {
        await fs.writeFile(
          process.env.SELE_IMAGE_EDITOR_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      }
      await click('Copy original.png')
      await wait(
        'document.querySelector(".image-lightbox__copy-feedback")?.textContent==="Copied to clipboard"'
      )
      assert.ok(redPixels(copied) > 1000)
      const pixel = (png, x, y) => {
        const image = nativeImage.createFromBuffer(png),
          data = image.toBitmap(),
          offset = (y * 800 + x) * 4
        return { b: data[offset], g: data[offset + 1], r: data[offset + 2] }
      }
      for (const [x, y] of [
        [175, 450],
        [100, 100],
        [548, 402],
        [650, 100]
      ]) {
        const color = pixel(copied, x, y)
        assert.ok(
          color.r > 200 && color.g < 80 && color.b < 80,
          `freehand mark is exported at ${x},${y}: ${JSON.stringify(color)}`
        )
      }
      assert.deepEqual(
        pixel(copied, 650, 150),
        { b: 255, g: 255, r: 255 },
        'saving a Shift arrow omits its unconstrained curve'
      )
      await click('Save original.png')
      await wait(
        'document.querySelector("[aria-label=\'Save original.png\']").title==="Save image"'
      )
      await pause()
      // A successful download and close must both contain annotation pixels.
      await wait('!document.querySelector("[aria-label=\'Save original.png\']").disabled')
      assert.ok(redPixels(await fs.readFile(path.join(directory, 'download.png'))) > 1000)
      fail = true
      await click('Close image preview')
      await wait(
        'document.querySelector(".image-lightbox__copy-feedback")?.textContent.includes("Fixture save failed")'
      )
      assert.equal(
        await run('fixture.image.path'),
        original,
        'failed save retains the original attachment and open editor'
      )
      fail = false
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await wait('!document.querySelector(".image-lightbox")')
      const saved = await run('fixture.image')
      assert.notEqual(saved.path, original)
      assert.equal(saved.previewOnly, true)
      assert.ok(redPixels(await fs.readFile(saved.path)) > 1000)
      assert.ok((await fs.readFile(original)).equals(bytes), 'source remains unchanged')
      await open()
      await wait('document.querySelector(".image-lightbox img")?.naturalWidth===800')
      assert.equal(await groups(), 0, 'reopen loads the saved composite')
      assert.ok(redPixels(await fs.readFile((await run('fixture.image')).path)) > 1000)
      await click('Close image preview')
      await wait('!document.querySelector(".image-lightbox")')
      assert.equal(
        (await run('fixture.image')).path,
        saved.path,
        'unchanged close does not rewrite'
      )
      await open()
      await click('Draw numbers')
      await draw(400, 300)
      await click('Undo annotation')
      await run(
        'document.querySelector(".image-lightbox__preview").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))'
      )
      await wait('!document.querySelector(".image-lightbox")')
      assert.equal(
        (await run('fixture.image')).path,
        saved.path,
        'undo all then close preserves attachment'
      )
      for (const [width, height] of [
        [100, 100],
        [800, 100],
        [100, 800]
      ]) {
        await open()
        await run(
          `(()=>{const c=document.createElement('canvas');c.width=${width};c.height=${height};document.querySelector('.image-lightbox img').src=c.toDataURL()})()`
        )
        await wait(
          `document.querySelector('.image-lightbox img').naturalWidth===${width} && document.querySelector('.image-lightbox img').naturalHeight===${height}`
        )
        await pause()
        assert.ok(
          await run(
            `(()=>{const r=document.querySelector('.image-annotations').getBoundingClientRect();return Math.abs(r.width/r.height-${width / height})<0.01})()`
          ),
          'small and extreme aspect ratios keep annotations aligned'
        )
        await assertToolbar()
        await click('Close image preview')
        await wait('!document.querySelector(".image-lightbox")')
      }
      // SVG uses Chromium's decoded snapshot; compositing still belongs in the worker.
      await open()
      await run(
        `document.querySelector('.image-lightbox img').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="white"/></svg>')`
      )
      await wait('document.querySelector(".image-lightbox img").complete')
      await pause()
      await click('Draw arrows')
      await draw(100, 100, 300, 200)
      assert.equal(await groups(), 1)
      await click('Copy original.png')
      await wait(
        'document.querySelector(".image-lightbox__copy-feedback")?.textContent==="Copied to clipboard"'
      )
      assert.ok(redPixels(copied) > 100)
      await click('Close image preview')
      await wait('!document.querySelector(".image-lightbox")')
      // Navigation saves edits before switching, skips files, and shares numbering.
      await run('fixture.addImage()')
      await open()
      await assertToolbar()
      assert.equal(
        await run('document.querySelector(".image-lightbox__position").textContent'),
        '1 / 2'
      )
      await click('Draw numbers')
      await draw(300, 300)
      const firstNumber = Number((await labels())[0])
      assert.ok(firstNumber > 2, 'reopening continues after numbers baked into the attachment')
      fail = true
      await click('Next media')
      await wait(
        'document.querySelector(".image-lightbox__copy-feedback")?.textContent.includes("Fixture save failed")'
      )
      assert.equal(
        await run('document.querySelector(".image-lightbox__position").textContent'),
        '1 / 2'
      )
      assert.deepEqual(await labels(), [String(firstNumber)], 'failed navigation retains edits')
      fail = false
      await click('Next media')
      await wait('document.querySelector(".image-lightbox__position")?.textContent==="2 / 2"')
      await wait('document.querySelector(".image-lightbox img")?.naturalWidth===800')
      assert.equal(await selectedTool(), 'Draw numbers', 'next image retains the selected tool')
      await draw(300, 300)
      assert.deepEqual(await labels(), [String(firstNumber + 1)])
      await click('Undo annotation')
      await click('Draw numbered arrows')
      await draw(100, 100, 300, 200)
      assert.deepEqual(await labels(), [String(firstNumber + 1)])
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
      await wait('document.querySelector(".image-lightbox__position")?.textContent==="1 / 2"')
      await wait('document.querySelector(".image-lightbox img")?.naturalWidth===800')
      assert.equal(
        await selectedTool(),
        'Draw numbered arrows',
        'keyboard navigation retains the selected tool'
      )
      await click('Draw numbers')
      await draw(400, 300)
      assert.deepEqual(await labels(), [String(firstNumber + 2)])
      await click('Undo annotation')
      await click('Previous media')
      await wait('document.querySelector(".image-lightbox__position")?.textContent==="2 / 2"')
      assert.equal(await selectedTool(), 'Draw numbers', 'previous image retains the selected tool')
      await click('Close image preview')
      await wait('!document.querySelector(".image-lightbox")')
      await run('fixture.open(2)')
      await wait('document.querySelector(".image-lightbox img")?.naturalWidth===800')
      assert.equal(await selectedTool(), 'Draw numbers', 'close/reopen retains the selected tool')
      await draw(400, 300)
      assert.deepEqual(
        await labels(),
        [String(firstNumber + 2)],
        'close/reopen preserves the shared counter'
      )
      win.setContentSize(375, 812)
      await pause()
      await assertToolbar()
      await click('Next media')
      await wait('document.querySelector(".image-lightbox__position")?.textContent==="1 / 2"')
      await wait('document.querySelector(".image-lightbox img")?.naturalWidth===800')
      await assertToolbar()
      await click('Close image preview')
      await wait('!document.querySelector(".image-lightbox")')
      await open()
      await click('Draw numbers')
      assert.equal(await selectedTool(), null)
      await click('Next media')
      await wait('document.querySelector(".image-lightbox__position")?.textContent==="2 / 2"')
      assert.equal(await selectedTool(), null, 'navigation retains a deselected tool')
      await click('Close image preview')
      await wait('!document.querySelector(".image-lightbox")')
      await open()
      assert.equal(await selectedTool(), null, 'close/reopen retains a deselected tool')
      await click('Close image preview')
      await wait('!document.querySelector(".image-lightbox")')
      win.setContentSize(1100, 800)
      // Keep full-resolution work off the renderer, and exercise real typing and
      // frame delivery while a noisy 24-megapixel image is being saved.
      for (const source of [true, 'inline']) {
        await run(
          `window.appApi.fixtureImage(${JSON.stringify(source)}).then(image=>fixture.replace(image))`
        )
        await pause()
        await open()
        await wait('document.querySelector(".image-lightbox img")?.naturalWidth===6000')
        if ((await selectedTool()) !== 'Draw numbered arrows') await click('Draw numbered arrows')
        await draw(100, 100, 300, 200)
        await run(`(()=>{
        window.saveMetrics={gaps:[],tasks:[],inputs:0};
        window.canvasContext=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(){throw Error('Saving must not use a canvas on the UI thread')};
        window.lastFrame=performance.now();
        window.frame=requestAnimationFrame(function tick(now){saveMetrics.gaps.push(now-lastFrame);lastFrame=now;window.frame=requestAnimationFrame(tick)});
        window.observer=new PerformanceObserver(list=>saveMetrics.tasks.push(...list.getEntries().map(e=>e.duration)));
        observer.observe({type:'longtask'});
        const input=document.querySelector('textarea');input.value='';input.oninput=()=>saveMetrics.inputs++;
        document.querySelector('[aria-label="Close image preview"]').click();
        input.focus();
      })()`)
        const typing = setInterval(
          () => win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' }),
          20
        )
        let metrics
        try {
          await wait('!document.querySelector(".image-lightbox")')
          metrics = await run(
            `(()=>{observer.disconnect();cancelAnimationFrame(frame);HTMLCanvasElement.prototype.getContext=canvasContext;return {...saveMetrics,maxFrameGap:Math.max(0,...saveMetrics.gaps)}})()`
          )
        } finally {
          clearInterval(typing)
        }
        assert.deepEqual(
          metrics.tasks,
          [],
          'saving a large image must not create renderer long tasks'
        )
        assert.ok(metrics.gaps.length >= 3, 'frames continue during saving')
        assert.ok(metrics.maxFrameGap < 100, JSON.stringify(metrics))
        assert.ok(metrics.inputs >= 3, 'keyboard input continues during saving')
        const largeSaved = await run('fixture.image')
        assert.notEqual(largeSaved.path, largePath)
        assert.deepEqual(
          nativeImage.createFromBuffer(await fs.readFile(largeSaved.path)).getSize(),
          {
            width,
            height
          }
        )
        console.log(
          'Large image save responsiveness:',
          JSON.stringify({
            source: source === true ? 'blob URL' : 'data URL',
            frames: metrics.gaps.length,
            maxFrameGap: metrics.maxFrameGap,
            inputs: metrics.inputs,
            longTasks: metrics.tasks.length
          })
        )
      }
      assert.deepEqual(errors, [])
      console.log(
        'Image annotations passed: brush/dots, freehand arrows, shared numbers, undo, wheel, copy/download pixels, save failure/retry, source preservation, and reopen.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      app.exit(code)
    }
  })
}
