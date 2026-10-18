const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { build } = require('esbuild')
  const { spawnSync } = require('node:child_process')
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-video-test-'))
    try {
      await build({
        entryPoints: [path.join(__dirname, 'fixtures/video-message.tsx')],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        jsx: 'automatic',
        outfile: path.join(directory, 'message.js'),
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' },
        define: { 'process.env.NODE_ENV': '"development"' },
        plugins: [
          {
            name: 'unused-worker',
            setup(builder) {
              builder.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              builder.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await build({
        entryPoints: [path.resolve(__dirname, '../../src/main/videoClipboard.ts')],
        bundle: true,
        platform: 'node',
        outfile: path.join(directory, 'clipboard.cjs'),
        external: ['electron']
      })
      const html = await fs.readFile(
        path.resolve(__dirname, '../../src/renderer/index.html'),
        'utf8'
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        html.replace(
          '<script type="module" src="/src/main.tsx"></script>',
          '<link rel="stylesheet" href="message.css"><script src="message.js"></script>'
        )
      )
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `
        const { contextBridge, ipcRenderer } = require('electron')
        contextBridge.exposeInMainWorld('appApi', Object.fromEntries(
          ['getLocalVideo', 'getLocalImage', 'copyLocalVideo', 'saveLocalVideo', 'writeClipboardImage', 'saveLocalImage']
            .map(name => [name, options => ipcRenderer.invoke(name, options)])
        ))
      `
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const args = [__filename, directory, '--no-sandbox']
      if (process.argv.includes('--cache-only')) args.push('--cache-only')
      const result = spawnSync(require('electron'), args, {
        env,
        encoding: 'utf8',
        timeout: 45000
      })
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) throw new Error(result.stderr || String(result.error))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, ipcMain, clipboard } = require('electron')
  const directory = process.argv[2]
  app.setPath('userData', path.join(directory, 'user-data'))
  app
    .whenReady()
    .then(async () => {
      const video = await fs.readFile(path.join(__dirname, 'fixtures/preview-video.webm'))
      const calls = []
      for (const name of [
        'getLocalVideo',
        'getLocalImage',
        'copyLocalVideo',
        'saveLocalVideo',
        'writeClipboardImage',
        'saveLocalImage'
      ]) {
        ipcMain.handle(name, (_event, options) => {
          calls.push({ name, options })
          if (options.path === './missing.webm') throw new Error('Missing video')
          if (name === 'getLocalVideo')
            return { data: Uint8Array.from(video).buffer, mimeType: 'video/webm', updatedAt: 0 }
          if (name === 'getLocalImage')
            return {
              data: Uint8Array.from(
                Buffer.from(
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
                  'base64'
                )
              ).buffer,
              mimeType: 'image/png',
              updatedAt: 0
            }
          return name.startsWith('save') ? '/downloads/saved.webm' : undefined
        })
      }
      const window = new BrowserWindow({
        show: true,
        width: 1000,
        height: 750,
        webPreferences: { preload: path.join(directory, 'preload.cjs'), sandbox: true }
      })
      const js = (code, gesture = false) => window.webContents.executeJavaScript(code, gesture)
      const waitFor = async (code) => {
        const deadline = Date.now() + 8000
        while (!(await js(code))) {
          assert.ok(Date.now() < deadline, `Timed out: ${code}`)
          await new Promise((resolve) => setTimeout(resolve, 40))
        }
      }
      const assertNavigationGap = async () => {
        const bounds = await js(`(() => {
          const frame = document.querySelector('.image-lightbox__frame').getBoundingClientRect()
          const previous = document.querySelector('[aria-label="Previous media"]')?.getBoundingClientRect()
          const next = document.querySelector('[aria-label="Next media"]')?.getBoundingClientRect()
          return {
            previousGap: previous ? frame.left - previous.right : null,
            nextGap: next ? next.left - frame.right : null,
            inside: (!previous || previous.left >= 0) && (!next || next.right <= innerWidth)
          }
        })()`)
        for (const gap of [bounds.previousGap, bounds.nextGap]) {
          if (gap !== null) assert.ok(gap >= 8 && gap <= 16, `Navigation gap: ${gap}`)
        }
        assert.equal(bounds.inside, true)
      }
      await window.loadFile(path.join(directory, 'index.html'))
      await waitFor("document.querySelector('.chat-detail__markdown-video video')?.readyState >= 2")
      assert.equal(await js("document.querySelectorAll('.chat-detail__markdown-video').length"), 3)
      assert.equal(
        await js("document.querySelector('.chat-detail__markdown-video video').paused"),
        true
      )
      assert.ok(
        await js(
          "document.querySelector('.chat-detail__markdown-video').getBoundingClientRect().width < 200"
        )
      )
      await waitFor(
        "document.querySelector('[data-local-image-path=\"./missing.webm\"]')?.getAttribute('aria-disabled') === 'true'"
      )
      await waitFor('document.querySelector(\'[aria-label="Open Attachment two"] img\')?.complete')
      assert.equal(
        calls.filter(
          (call) => call.name === 'getLocalImage' && call.options.path === './attachment.png'
        ).length,
        1,
        'duplicate thumbnails share a single media read'
      )
      const videoReads = calls.filter(
        (call) => call.name === 'getLocalVideo' && call.options.path === './demo.webm'
      ).length
      if (process.argv.includes('--cache-only')) {
        await waitFor(
          'document.querySelector(\'[data-local-image-path="./image.png"] img\')?.complete'
        )
        await waitFor(
          'document.querySelector(\'[data-local-image-path="./later.png"] img\')?.complete'
        )
        await js(
          `window.attachmentUrl = document.querySelector('[aria-label="Open Attachment one"] img').src`
        )
        const readCount = calls.filter(
          (call) =>
            ['getLocalImage', 'getLocalVideo'].includes(call.name) &&
            call.options.path !== './missing.webm'
        ).length
        await js("document.querySelector('.chat-detail__markdown-video').click()", true)
        await waitFor("document.querySelector('.image-lightbox video')?.readyState >= 2")
        assert.equal(
          await js(
            `document.querySelector('.image-lightbox video').src === document.querySelector('.chat-detail__markdown-video video').src`
          ),
          true
        )
        await js('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')
        const opened = await js(`new Promise(resolve => {
          document.querySelector('[data-local-image-path="./image.png"]').click();
          requestAnimationFrame(() => resolve({
            src: document.querySelector('.image-lightbox img')?.src,
            thumbnail: document.querySelector('[data-local-image-path="./image.png"] img').src,
            status: Boolean(document.querySelector('.image-lightbox__status'))
          }));
        })`)
        assert.equal(opened.src, opened.thumbnail, 'viewer reuses the thumbnail URL before paint')
        assert.equal(opened.status, false, 'cached viewer has no loading flash')
        await js('document.querySelector(\'[aria-label="Next media"]\').click()')
        await waitFor(
          'document.querySelector(\'.image-lightbox[aria-label="Later image preview"] img\')'
        )
        await js('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')
        await js('document.querySelector("#later-page").click()')
        await waitFor('!document.querySelector(\'[aria-label="Open Attachment one"]\')')
        const returned = await js(`new Promise(resolve => {
          document.querySelector('#all-pages').click();
          requestAnimationFrame(() => resolve({
            attachment: document.querySelector('[aria-label="Open Attachment one"] img')?.src,
            markdown: Boolean(document.querySelector('[data-local-image-path="./image.png"] img')),
            loading: Boolean(document.querySelector('.chat-detail__generated-image-loading, .chat-detail__markdown-image-loading'))
          }));
        })`)
        assert.equal(returned.attachment, await js('window.attachmentUrl'))
        assert.equal(returned.markdown, true)
        assert.equal(returned.loading, false, 'returning to history restores images before paint')
        assert.equal(
          calls.filter(
            (call) =>
              ['getLocalImage', 'getLocalVideo'].includes(call.name) &&
              call.options.path !== './missing.webm'
          ).length,
          readCount,
          'gallery navigation and history remounts perform no additional file reads'
        )
        window.destroy()
        console.log(
          'Media cache: duplicate reads, shared viewer URLs, gallery navigation, and history remounts before paint passed.'
        )
        app.quit()
        return
      }
      for (const close of ['button', 'escape', 'backdrop']) {
        await js("document.querySelector('.chat-detail__markdown-video').click()", true)
        await waitFor("document.querySelector('.image-lightbox video')?.currentTime > 0")
        assert.equal(await js("document.querySelector('.image-lightbox video').controls"), true)
        await assertNavigationGap()
        if (close === 'button') {
          const artifacts = path.resolve(__dirname, '../../test-results/media-gallery')
          await fs.mkdir(artifacts, { recursive: true })
          await fs.writeFile(
            path.join(artifacts, 'preview.png'),
            (await window.webContents.capturePage()).toPNG()
          )
        }
        assert.equal(
          await js("getComputedStyle(document.querySelector('.image-lightbox__frame')).resize"),
          'both'
        )
        assert.equal(
          await js(`(() => {
            const frame = document.querySelector('.image-lightbox__frame')
            frame.style.width = '300px'
            frame.style.height = '160px'
            const frameBounds = frame.getBoundingClientRect()
            const videoBounds = frame.querySelector('video').getBoundingClientRect()
            return videoBounds.width <= frameBounds.width && videoBounds.height <= frameBounds.height
          })()`),
          true
        )
        await assertNavigationGap()
        if (close === 'button') {
          await js('document.querySelector(".image-lightbox__frame").style.width = "1000px"')
          await assertNavigationGap()
          window.setContentSize(420, 750)
          await waitFor('innerWidth === 420')
          await assertNavigationGap()
          window.setContentSize(1000, 750)
          await waitFor('innerWidth === 1000')
          await js('document.querySelector(\'[aria-label="Copy Demo"]\').click()')
          await js('document.querySelector(\'[aria-label="Save Demo"]\').click()')
          await js('document.querySelector(\'[aria-label="Close video preview"]\').click()')
        } else if (close === 'escape') {
          await js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))")
        } else {
          await js(
            "document.querySelector('.image-lightbox__preview').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))"
          )
        }
        await waitFor("!document.querySelector('.image-lightbox')")
      }
      assert.equal(
        calls.filter((call) => call.name === 'getLocalVideo' && call.options.path === './demo.webm')
          .length,
        videoReads,
        'reopening the viewer reuses the thumbnail resource'
      )
      for (const name of ['copyLocalVideo', 'saveLocalVideo']) {
        const call = calls.find((call) => call.name === name)
        assert.deepEqual(call.options, {
          container: { kind: 'container', tool: 'ssh', name: 'test', runtime: { kind: 'host' } },
          cwd: '/work',
          path: './demo.webm',
          relativeTo: 'cwd'
        })
      }
      await js('document.querySelector(\'[data-local-image-path="./image.png"]\').click()', true)
      await waitFor("document.querySelector('.image-lightbox img')")
      assert.equal(
        await js('getComputedStyle(document.querySelector(".image-lightbox img")).animationName'),
        'image-lightbox-media-enter'
      )
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      assert.equal(
        await js('getComputedStyle(document.querySelector(".image-lightbox img")).animationName'),
        'none'
      )
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
      window.webContents.debugger.detach()
      await js('document.querySelector(\'[aria-label="Copy Image"]\').click()')
      await waitFor('document.querySelector(\'[aria-label="Copy Image"] svg.lucide-check\')')
      await js('document.querySelector(\'[aria-label="Save Image"]\').click()')
      assert.ok(calls.some((call) => call.name === 'writeClipboardImage'))
      assert.ok(calls.some((call) => call.name === 'saveLocalImage'))

      // Navigate every occurrence, including duplicate attachments and response media.
      await js('document.querySelector(\'[aria-label="Previous media"]\').click()')
      await waitFor(
        "document.querySelector('.image-lightbox [role=alert]')?.textContent.includes('Missing')"
      )
      await js(
        'document.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowLeft", cancelable:true}))'
      )
      await waitFor(
        'document.querySelector(\'.image-lightbox[aria-label="Embedded preview"] video\')'
      )
      await js(
        'document.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowLeft", cancelable:true}))'
      )
      await waitFor('document.querySelector(\'.image-lightbox[aria-label="Demo preview"] video\')')
      await js('document.querySelector(\'[aria-label="Previous media"]\').click()')
      await waitFor(
        'document.querySelector(\'.image-lightbox[aria-label="Attachment two preview"] img\')'
      )
      await js('document.querySelector(\'[aria-label="Previous media"]\').click()')
      await waitFor(
        'document.querySelector(\'.image-lightbox[aria-label="Attachment one preview"] img\')'
      )
      assert.equal(await js('document.querySelector(\'[aria-label="Previous media"]\')'), null)
      assert.equal(
        await js('document.querySelector(".image-lightbox__position").textContent'),
        '1 / 8'
      )
      await js('document.querySelector(\'[aria-label="Close image preview"]\').click()')

      // Clicking the second identical thumbnail must open that occurrence.
      await js('document.querySelector(\'[aria-label="Open Attachment two"]\').click()')
      await waitFor('document.querySelector(".image-lightbox__position")?.textContent === "2 / 8"')
      await js('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')
      await js('document.querySelector(\'[aria-label="Open Later image"]\').click()')
      await waitFor(
        'document.querySelector(\'.image-lightbox[aria-label="Later image preview"] img\')'
      )
      await js('document.querySelector(\'[aria-label="Next media"]\').click()')
      await waitFor('document.querySelector(\'.image-lightbox[aria-label="Remote preview"] img\')')
      assert.equal(await js('document.querySelector(\'[aria-label="Next media"]\')'), null)
      await js('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')

      // Source paths survive transcript page eviction; another chat has its own list.
      await js('document.querySelector("#later-page").click()')
      await waitFor('!document.querySelector(\'[aria-label="Open Attachment one"]\')')
      await js('document.querySelector(\'[aria-label="Open Later image"]\').click()')
      await waitFor('document.querySelector(".image-lightbox__position")?.textContent === "7 / 8"')
      await js('document.querySelector(\'[aria-label="Previous media"]\').click()')
      await waitFor('document.querySelector(\'.image-lightbox[aria-label="Image preview"] img\')')
      await js('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')
      const attachmentReads = calls.filter(
        (call) => call.name === 'getLocalImage' && call.options.path === './attachment.png'
      ).length
      await js('document.querySelector("#all-pages").click()')
      await waitFor('document.querySelector(\'[aria-label="Open Attachment one"] img\')?.complete')
      assert.equal(
        calls.filter(
          (call) => call.name === 'getLocalImage' && call.options.path === './attachment.png'
        ).length,
        attachmentReads,
        'paging back restores attachments without another file read'
      )
      await js('document.querySelector("#switch-chat").click()')
      await waitFor('!document.querySelector(".image-lightbox")')
      await js('document.querySelector(\'[aria-label="Open Later image"]\').click()')
      await waitFor('document.querySelector(".image-lightbox__position")?.textContent === "1 / 2"')
      if (process.platform === 'linux') {
        const { copyVideoFile } = require(path.join(directory, 'clipboard.cjs'))
        await copyVideoFile('demo video.webm', video)
        const url = clipboard.readBuffer('text/uri-list').toString().trim()
        assert.deepEqual(await fs.readFile(new URL(url)), video)
      }
      window.destroy()
      console.log(
        'Media gallery: video playback, copy/save, close methods, occurrence order, duplicates, keyboard navigation, missing files, retained paths, chat isolation, and clipboard passed.'
      )
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
