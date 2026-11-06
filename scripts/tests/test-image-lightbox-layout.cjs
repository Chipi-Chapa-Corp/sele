const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-lightbox-layout-')
    )
    try {
      await require('esbuild').build({
        stdin: {
          resolveDir: process.cwd(),
          loader: 'tsx',
          contents: `
          import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
          import {ImageLightbox} from './src/renderer/src/components/ImageLightbox';
          import './src/renderer/src/assets/main.css';
          const sizes=[[800,4000],[4000,800],[50,200]];
          function Fixture(){const [index,setIndex]=useState(0),[open,setOpen]=useState(true),[gallery,setGallery]=useState(true);
            window.fixture={open:(index=0,gallery=true)=>{setIndex(index);setGallery(gallery);setOpen(true)}};
            const [width,height]=sizes[index];const source='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><rect width="100%" height="100%" fill="#527596"/></svg>');
            return open&&<ImageLightbox key={index} name="Layout fixture" imageUrl={source} onClose={()=>setOpen(false)} count={gallery?3:1} position={index+1} onPrevious={gallery?()=>setIndex((index+2)%3):undefined} onNext={gallery?()=>setIndex((index+1)%3):undefined}/>}
          createRoot(document.getElementById('root')).render(<Fixture/>);`
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'dataurl', '.woff2': 'dataurl' },
        outfile: path.join(directory, 'fixture.js')
      })
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = require('node:child_process').spawn(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, stdio: 'inherit' }
      )
      assert.equal(await new Promise((resolve) => child.once('exit', resolve)), 0)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    try {
      const win = new BrowserWindow({
        show: true,
        width: 1100,
        height: 800,
        webPreferences: { backgroundThrottling: false }
      })
      const run = (source) => win.webContents.executeJavaScript(source)
      const pause = () => new Promise((resolve) => setTimeout(resolve, 200))
      const wait = async (source) => {
        const end = Date.now() + 5000
        while (!(await run(source))) {
          assert.ok(Date.now() < end, source)
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      }
      const click = async (x, y) => {
        const point = { x: Math.round(x), y: Math.round(y) }
        win.webContents.sendInputEvent({
          type: 'mouseDown',
          button: 'left',
          clickCount: 1,
          ...point
        })
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
        await pause()
      }
      const bounds = () =>
        run(
          `(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};return {image:rect('.image-lightbox img'),frame:rect('.image-lightbox__frame'),stage:rect('.image-lightbox__stage'),previous:rect('.image-lightbox__previous'),next:rect('.image-lightbox__next'),viewport:{width:innerWidth,height:innerHeight},natural:{width:document.querySelector('.image-lightbox img').naturalWidth,height:document.querySelector('.image-lightbox img').naturalHeight}}})()`
        )
      const ready = async (width) => {
        await wait(`document.querySelector('.image-lightbox img')?.naturalWidth===${width}`)
        await pause()
      }
      const assertFitted = (r) => {
        assert.ok(Math.abs(r.frame.width - r.image.width) < 1, JSON.stringify(r))
        assert.ok(Math.abs(r.stage.width - r.image.width) < 1, JSON.stringify(r))
        assert.ok(
          Math.abs(r.image.width / r.image.height - r.natural.width / r.natural.height) < 0.01,
          JSON.stringify(r)
        )
        assert.ok(Math.abs(r.previous.right - r.image.x + 12) < 1, JSON.stringify(r))
        assert.ok(Math.abs(r.next.x - r.image.right - 12) < 1, JSON.stringify(r))
        assert.ok(r.previous.x >= 0 && r.next.right <= r.viewport.width, JSON.stringify(r))
        assert.ok(r.image.y >= 0 && r.image.bottom <= r.viewport.height, JSON.stringify(r))
      }
      await win.loadFile(path.join(directory, 'index.html'))
      await ready(800)
      assertFitted(await bounds())
      if (process.env.SELE_LIGHTBOX_SCREENSHOT)
        await fs.writeFile(
          process.env.SELE_LIGHTBOX_SCREENSHOT,
          (await win.webContents.capturePage()).toPNG()
        )
      // Image clicks stay open. Each gap between a portrait and its arrows dismisses.
      let r = await bounds()
      await click(r.image.x + r.image.width / 2, r.image.y + r.image.height / 2)
      assert.ok(await run('Boolean(document.querySelector(".image-lightbox"))'))
      await click(r.next.x + r.next.width / 2, r.next.y + r.next.height / 2)
      await ready(4000)
      assertFitted(await bounds())
      await run('fixture.open(0)')
      await ready(800)
      r = await bounds()
      await click(r.image.right + 6, r.image.y + r.image.height / 2)
      await wait('!document.querySelector(".image-lightbox")')
      await run('fixture.open(0)')
      await ready(800)
      r = await bounds()
      await click(r.image.x - 6, r.image.y + r.image.height / 2)
      await wait('!document.querySelector(".image-lightbox")')
      await run('fixture.open(2)')
      await ready(50)
      assertFitted(await bounds())
      // Explicitly resized popups can have extra interior space. It is backdrop too.
      await run('fixture.open(0)')
      await ready(800)
      await run('document.querySelector(".image-lightbox__frame").style.width="700px"')
      await pause()
      r = await bounds()
      await click(r.frame.right - 30, r.frame.y + r.frame.height / 2)
      await wait('!document.querySelector(".image-lightbox")')
      for (const index of [0, 1, 2]) {
        win.setContentSize(375, 812)
        await run(`fixture.open(${index})`)
        await ready([800, 4000, 50][index])
        assertFitted(await bounds())
        await run('document.querySelector("[aria-label=\'Close image preview\']").click()')
        await wait('!document.querySelector(".image-lightbox")')
      }
      // A single-image preview follows the same sizing without gallery controls.
      win.setContentSize(1100, 800)
      await run('fixture.open(0,false)')
      await ready(800)
      const single = await run(
        '(()=>{const f=document.querySelector(".image-lightbox__frame").getBoundingClientRect(),i=document.querySelector(".image-lightbox img").getBoundingClientRect();return {frame:f.width,image:i.width}})()'
      )
      assert.ok(Math.abs(single.frame - single.image) < 1)
      console.log(
        'Lightbox layout passed: portrait/landscape/tiny images, desktop/mobile, navigation spacing, image clicks, and backdrop gaps including resized frames.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    } finally {
      app.exit(code)
    }
  })
}
