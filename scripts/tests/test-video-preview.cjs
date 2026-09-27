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
          ['getLocalVideo', 'getLocalImage', 'copyLocalVideo', 'saveLocalVideo', 'copyLocalImage', 'saveLocalImage']
            .map(name => [name, options => ipcRenderer.invoke(name, options)])
        ))
      `
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(require('electron'), [__filename, directory, '--no-sandbox'], {
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
        'copyLocalImage',
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
        show: false,
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
      for (const close of ['button', 'escape', 'backdrop']) {
        await js("document.querySelector('.chat-detail__markdown-video').click()", true)
        await waitFor("document.querySelector('.image-lightbox video')?.currentTime > 0")
        assert.equal(await js("document.querySelector('.image-lightbox video').controls"), true)
        if (close === 'button') {
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
      await js('document.querySelector(\'[aria-label="Copy Image"]\').click()')
      await js('document.querySelector(\'[aria-label="Save Image"]\').click()')
      assert.ok(calls.some((call) => call.name === 'copyLocalImage'))
      assert.ok(calls.some((call) => call.name === 'saveLocalImage'))
      if (process.platform === 'linux') {
        const { copyVideoFile } = require(path.join(directory, 'clipboard.cjs'))
        await copyVideoFile('demo video.webm', video)
        const url = clipboard.readBuffer('text/uri-list').toString().trim()
        assert.deepEqual(await fs.readFile(new URL(url)), video)
      }
      window.destroy()
      console.log(
        'Video preview: thumbnail, autoplay, media actions, all close methods, missing files, image regression, and clipboard passed.'
      )
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
