const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-file-editor-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React from 'react'
            import {createRoot} from 'react-dom/client'
            import {flushSync} from 'react-dom'
            import {FileEditorDialog} from './src/renderer/src/components/FileEditorDialog'
            import {ImageLightbox} from './src/renderer/src/components/ImageLightbox'
            import {copyRenderedImage} from './src/renderer/src/imageClipboard'
            const root = createRoot(document.getElementById('root'))
            let key = 0
            window.renderEditor = (path = 'docs/README.md') => flushSync(() => root.render(
              <FileEditorDialog key={++key} target={{cwd: '/project/subfolder', path, displayPath: path,
                container: {kind: 'container', tool: 'ssh', name: 'test'}}}
                onClose={() => { window.closedCount++; root.render(null) }} />
            ))
            window.renderEditor()
            window.copyRenderedImage = copyRenderedImage
            window.renderLightbox = (imageUrl, path) => flushSync(() => root.render(
              <ImageLightbox key={++key} imageUrl={imageUrl} name="Clipboard fixture" path={path} onClose={() => root.render(null)} />
            ))
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        plugins: [
          {
            name: 'test-editor-input',
            setup(build) {
              build.onLoad({ filter: /\/UnifiedDiff\.tsx$/ }, () => ({
                contents: `import React from 'react'; export const UnifiedDiff = () => null;
                export const EditableUnifiedDiff = ({contents, onChange}) =>
                  <textarea aria-label="Test contents" value={contents} onChange={e => onChange(e.target.value)} />`,
                loader: 'tsx'
              }))
            }
          }
        ],
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'test.js')
      })
      await require('esbuild').build({
        entryPoints: [path.resolve(__dirname, '../../src/main/imageClipboard.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron'],
        outfile: path.join(directory, 'clipboard.cjs')
      })
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `const {contextBridge, ipcRenderer} = require('electron');
        contextBridge.exposeInMainWorld('clipboardApi', {
          writeClipboardImage: png => ipcRenderer.invoke('test:copy-image', png)
        });`
      )
      await fs.writeFile(
        path.join(directory, 'test.html'),
        `<!doctype html>
        <link rel="stylesheet" href="test.css"><style>:root { --floating-bg: white; --control-height: 32px; }</style>
        <div id="root"></div><script>
          window.closedCount = 0; window.writes = []; window.images = []; window.failSave = false;
          window.appApi = {
            ...window.clipboardApi,
            getFileContents: async () => ({contents: '# README\\n![Local](./images/a%20b.svg)\\n<img src="../logo.svg" alt="Logo">\\n![Remote](https://example.com/image.png)',
              version: 'v1', editable: true, gitRepositoryRoot: '/project'}),
            getFileTree: async () => ({repositoryRoot: '/project/subfolder', branchName: 'main', files: []}),
            getGitFileDiff: async () => ({diff: ''}),
            getLocalImage: async options => {
              window.images.push(options);
              return {data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="10" fill="red"/></svg>').buffer, mimeType: 'image/svg+xml'};
            },
            writeFileContents: async options => {
              window.writes.push(options);
              if (window.failSave) throw new Error('Save failed for test');
              if (window.delaySave) await new Promise(resolve => window.finishSave = resolve);
              return {version: 'v2'};
            }
          };
        </script><script src="test.js"></script>`
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 55000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0 || !result.stdout.includes('File editor checks passed'))
        throw new Error(result.stderr || String(result.error || 'Electron check failed'))
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow, clipboard, ipcMain, nativeImage } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  const { writeClipboardImage } = require(path.join(process.argv[2], 'clipboard.cjs'))
  ipcMain.handle('test:copy-image', (_event, png) => writeClipboardImage(png))
  app.whenReady().then(async () => {
    const window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      webPreferences: { offscreen: true, preload: path.join(process.argv[2], 'preload.cjs') }
    })
    const run = async (source) => {
      try {
        return await window.webContents.executeJavaScript(source)
      } catch (error) {
        throw new Error(`Renderer check failed: ${source}`, { cause: error })
      }
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 180))
    const click = async (selector) => {
      await run(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await settle()
    }
    const action = async (label) => {
      await run(
        `[...document.querySelectorAll('.file-editor-confirm button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`
      )
      await settle()
    }
    const edit = async () => {
      await run(
        'document.querySelector("textarea").focus(); document.querySelector("textarea").select()'
      )
      await window.webContents.insertText('Edited README')
      await settle()
    }
    const close = () => click('[aria-label="Close file editor"]')
    let exitCode = 0
    try {
      await window.loadFile(path.join(process.argv[2], 'test.html'))
      await settle()
      await click('[aria-label="Preview"]')
      const images = await run('window.images')
      assert.deepEqual(images.map((image) => image.path).sort(), [
        'docs/../logo.svg',
        'docs/./images/a b.svg'
      ])
      assert.ok(
        images.every(
          (image) =>
            image.cwd === '/project' &&
            image.relativeTo === 'cwd' &&
            image.container.name === 'test'
        )
      )
      assert.equal(
        await run(
          '[...document.querySelectorAll("img[data-file-image-path]")].every(img => img.src.startsWith("blob:") && img.naturalWidth === 10)'
        ),
        true
      )
      assert.equal(
        await run('document.querySelector("img[alt=Remote]").getAttribute("src")'),
        'https://example.com/image.png'
      )
      const rememberImages = () =>
        run(
          `window.previewImages = [...document.querySelectorAll('img[data-file-image-path]')]; window.imageReadCount = window.images.length`
        )
      const assertImagesRetained = async (message) => {
        assert.equal(
          await run(
            `window.previewImages.length === 2 && window.previewImages.every(image => image.isConnected && image.src.startsWith('blob:') && image.naturalWidth === 10)`
          ),
          true,
          message
        )
        assert.equal(
          await run('window.images.length === window.imageReadCount'),
          true,
          'unchanged images do not reload'
        )
      }
      await rememberImages()
      await click('[aria-label="Expand file editor"]')
      await assertImagesRetained('expanding preserves rendered images')
      await click('[aria-label="Collapse file editor"]')
      await assertImagesRetained('collapsing preserves rendered images')
      await click('[aria-label="Split"]')
      await rememberImages()
      await run(
        `document.querySelector('[aria-label="Resize Markdown editor and preview"]').focus()`
      )
      const splitBefore = await run(
        `document.querySelector('[aria-label="Resize Markdown editor and preview"]').getAttribute('aria-valuenow')`
      )
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
      await settle()
      assert.notEqual(
        await run(
          `document.querySelector('[aria-label="Resize Markdown editor and preview"]').getAttribute('aria-valuenow')`
        ),
        splitBefore
      )
      await assertImagesRetained('resizing the split preserves rendered images')
      await run(
        'document.querySelector("textarea").focus(); document.querySelector("textarea").setSelectionRange(0, 0)'
      )
      await window.webContents.insertText('Updated README\n')
      await settle()
      await rememberImages()
      await run('window.delaySave = true')
      await click('[aria-label="Save docs/README.md"]')
      await assertImagesRetained('starting a save preserves rendered images')
      await run('window.finishSave(); window.delaySave = false')
      await settle()
      await assertImagesRetained('finishing a save preserves rendered images')
      await click('[aria-label="Code"]')
      await edit()
      await close()
      assert.deepEqual(
        await run(
          '[...document.querySelectorAll(".file-editor-confirm button")].map(b => b.textContent)'
        ),
        ['Discard', 'Save', 'Cancel']
      )
      await action('Cancel')
      assert.equal(await run('window.closedCount'), 0)
      assert.equal(await run('document.querySelector("textarea").value'), 'Edited README')
      await close()
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await settle()
      assert.equal(
        await run('!!document.querySelector(".file-editor-confirm")'),
        false,
        'Escape cancels without closing editor'
      )
      await close()
      await run('window.failSave = true')
      await action('Save')
      assert.equal(await run('window.closedCount'), 0)
      assert.match(
        await run('document.querySelector(".file-editor-confirm [role=alert]").textContent'),
        /Save failed/
      )
      await run('window.failSave = false; window.delaySave = true')
      await action('Save')
      assert.equal(await run('window.closedCount'), 0, 'wait for save before close')
      assert.equal(
        await run(
          '[...document.querySelectorAll(".file-editor-confirm button")].every(b => b.disabled)'
        ),
        true
      )
      await run('window.finishSave()')
      await settle()
      assert.equal(await run('window.closedCount'), 1)
      assert.equal(await run('window.writes.at(-1).contents'), 'Edited README')
      await run("window.renderEditor('/elsewhere/docs/README.md'); window.images = []")
      await settle()
      await click('[aria-label="Split"]')
      assert.deepEqual(await run('window.images.map(i => i.path).sort()'), [
        '/elsewhere/docs/../logo.svg',
        '/elsewhere/docs/./images/a b.svg'
      ])
      await edit()
      await close()
      const writeCount = await run('window.writes.length')
      await action('Discard')
      assert.equal(await run('window.closedCount'), 2)
      assert.equal(await run('window.writes.length'), writeCount)
      await run('window.renderEditor()')
      await settle()
      await close()
      assert.equal(await run('window.closedCount'), 3, 'clean files close directly')

      // SVG renders in Chromium but cannot be passed directly to NativeImage.
      await run("window.renderEditor('picture.svg')")
      await settle()
      const imageReads = await run('window.images.length')
      const svgUrl = await run(`document.querySelector('img[alt="picture.svg"]').src`)
      const svgBytes = await run(`fetch(${JSON.stringify(svgUrl)}).then(r => r.text())`)
      assert.equal(nativeImage.createFromBuffer(Buffer.from(svgBytes)).isEmpty(), true)
      const assertClipboardPixels = async () => {
        const copied = clipboard.readImage()
        assert.deepEqual(copied.getSize(), { width: 10, height: 10 })
        assert.deepEqual(
          await run(`(async () => {
            const image = new Image(); image.src = ${JSON.stringify(copied.toDataURL())};
            await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            return [Array.from(context.getImageData(1, 1, 1, 1).data),
              Array.from(context.getImageData(8, 1, 1, 1).data)];
          })()`),
          [
            [255, 0, 0, 255],
            [0, 0, 0, 0]
          ],
          'clipboard preserves original dimensions, color, and transparency'
        )
      }
      clipboard.clear()
      await click('[aria-label="Copy picture.svg"]')
      assert.equal(
        await run(`document.querySelector('[aria-label="Copy picture.svg"]').textContent`),
        'Copied'
      )
      await assertClipboardPixels()
      assert.equal(await run('window.images.length'), imageReads, 'copy does not reread the file')

      // The lightbox also copies displayed images, including images without a file path.
      const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgBytes).toString('base64')}`
      for (const imagePath of ['/missing-after-preview.svg', null]) {
        await run(
          `window.renderLightbox(${JSON.stringify(svgDataUrl)}, ${JSON.stringify(imagePath)})`
        )
        await settle()
        clipboard.clear()
        await click('[aria-label="Copy Clipboard fixture"]')
        await assertClipboardPixels()
      }

      // Raster sources follow the same browser-to-PNG path.
      for (const mimeType of ['image/png', 'image/webp', 'image/jpeg']) {
        clipboard.clear()
        await run(`(async () => {
          const canvas = document.createElement('canvas'); canvas.width = 13; canvas.height = 7;
          const context = canvas.getContext('2d'); context.fillStyle = 'red'; context.fillRect(0, 0, 13, 7);
          const image = new Image(); image.src = canvas.toDataURL(${JSON.stringify(mimeType)});
          await window.copyRenderedImage(image);
        })()`)
        assert.deepEqual(clipboard.readImage().getSize(), { width: 13, height: 7 }, mimeType)
      }
      const beforeInvalidCopy = clipboard.readImage().toPNG()
      assert.throws(() => writeClipboardImage(new ArrayBuffer(0)), /No image data/)
      assert.throws(
        () => writeClipboardImage(new Uint8Array([1, 2, 3]).buffer),
        /could not be decoded/
      )
      assert.deepEqual(
        clipboard.readImage().toPNG(),
        beforeInvalidCopy,
        'invalid data preserves clipboard'
      )
      console.log(
        'File editor checks passed: Markdown images, resizing, saving, save/discard/cancel, and real clipboard round trips for SVG, PNG, WebP, JPEG in the editor and lightbox.'
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
