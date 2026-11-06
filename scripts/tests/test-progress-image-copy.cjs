const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sele-progress-copy-'))
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            import React, {useState} from 'react'
            import {createRoot} from 'react-dom/client'
            import {ChatDetailItem} from './src/renderer/src/components/ChatDetailItem'
            import {ChatMediaGallery} from './src/renderer/src/components/ChatMediaGallery'
            import {getProviderChatTurns} from './src/shared/chatTurns'
            import './src/renderer/src/assets/main.css'
            const tools = ['first', 'second'].map(id => ({
              type: 'tool', id, toolId: 'view_image', status: 'finished', activity: 'other',
              icon: 'image-view', label: 'Viewed image', command: null, cwd: null,
              stdout: null, diffs: [], backgroundSessionId: null, finishedBackgroundSessionId: null,
              rawInput: null, rawOutput: null, images: [{path: '/' + id + '.svg', name: id}]
            }))
            const working = {type: 'working', id: 'progress', status: 'working', items: tools}
            const turns = getProviderChatTurns([{type: 'message', id: 'user', role: 'user', content: 'Show images'}, working])
            function Fixture() {
              const [visible, setVisible] = useState(true)
              window.hideProgress = () => setVisible(false)
              return <ChatMediaGallery turns={turns} startIndex={0} totalCount={1}>
                <div id="transcript" style={{height: '500px', overflow: 'auto'}}>
                  {visible && <ChatDetailItem item={working} />}
                  <div style={{height: '3000px'}}>More agent progress</div>
                </div>
              </ChatMediaGallery>
            }
            createRoot(document.getElementById('root')).render(<Fixture />)
          `,
          resolveDir: path.resolve(__dirname, '../..'),
          loader: 'tsx'
        },
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        outfile: path.join(directory, 'fixture.js'),
        loader: { '.woff2': 'dataurl', '.ttf': 'dataurl' },
        plugins: [
          {
            name: 'unused-workers',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({
                contents: 'export default class {}'
              }))
            }
          }
        ]
      })
      await require('esbuild').build({
        entryPoints: [path.resolve(__dirname, '../../src/main/imageClipboard.ts')],
        bundle: true,
        platform: 'node',
        external: ['electron'],
        outfile: path.join(directory, 'clipboard.cjs')
      })
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `
        const {contextBridge, ipcRenderer} = require('electron')
        contextBridge.exposeInMainWorld('appApi', {
          getLocalImage: options => ipcRenderer.invoke('image', options),
          writeClipboardImage: data => ipcRenderer.invoke('copy', data)
        })
      `
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 30000 }
      )
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
  app.setPath('userData', path.join(directory, 'profile'))
  const { writeClipboardImage } = require(path.join(directory, 'clipboard.cjs'))
  let writes = 0
  let failCopy = false
  ipcMain.handle('copy', (_event, data) => {
    if (failCopy) throw new Error('Clipboard unavailable. Try copying again.')
    writeClipboardImage(data)
    writes++
  })
  ipcMain.handle('image', (_event, options) => {
    const width = options.path === '/first.svg' ? 200 : 320
    const color = options.path === '/first.svg' ? 'red' : 'blue'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="240"><rect width="100%" height="100%" fill="${color}"/></svg>`
    return { data: Uint8Array.from(Buffer.from(svg)).buffer, mimeType: 'image/svg+xml' }
  })
  app
    .whenReady()
    .then(async () => {
      const window = new BrowserWindow({
        show: true,
        width: 1100,
        height: 800,
        webPreferences: { preload: path.join(directory, 'preload.cjs') }
      })
      const js = (source) => window.webContents.executeJavaScript(source)
      const waitFor = async (source) => {
        const deadline = Date.now() + 5000
        while (!(await js(source))) {
          assert.ok(Date.now() < deadline, `Timed out: ${source}`)
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
      }
      const click = async (selector) => {
        const point = await js(
          `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}})()`
        )
        window.webContents.sendInputEvent({ type: 'mouseMove', ...point })
        await new Promise((resolve) => setTimeout(resolve, 180))
        window.webContents.sendInputEvent({
          type: 'mouseDown',
          button: 'left',
          clickCount: 1,
          ...point
        })
        window.webContents.sendInputEvent({
          type: 'mouseUp',
          button: 'left',
          clickCount: 1,
          ...point
        })
      }
      try {
        await window.loadFile(path.join(directory, 'index.html'))
        await waitFor(
          `document.querySelector('[aria-label="Open second"] img')?.naturalWidth === 320`
        )
        for (const [name, width] of [
          ['first', 200],
          ['second', 320]
        ]) {
          await js('document.querySelector("#transcript").scrollTop = 0')
          await click(`[aria-label="Open ${name}"]`)
          await waitFor(`document.querySelector('.image-lightbox img')?.naturalWidth === ${width}`)
          // Scroll while the popup is open, then detach its progress thumbnails.
          window.webContents.sendInputEvent({
            type: 'mouseWheel',
            x: 500,
            y: 400,
            deltaY: 220,
            deltaX: 0
          })
          await js('document.querySelector("#transcript").scrollTop = 400')
          if (name === 'second') {
            await js('window.hideProgress()')
            failCopy = true
            await click(`[aria-label="Copy ${name}"]`)
            await waitFor(`document.querySelector('.image-lightbox [role="alert"]')`)
            assert.equal(
              await js(`document.querySelector('.image-lightbox [role="alert"]').textContent`),
              'Clipboard unavailable. Try copying again.'
            )
            assert.deepEqual(clipboard.readImage().getSize(), { width: 200, height: 240 })
            const screenshots = path.resolve(__dirname, '../../test-results/progress-image-copy')
            await fs.mkdir(screenshots, { recursive: true })
            await fs.writeFile(
              path.join(screenshots, 'copy-error.png'),
              (await window.webContents.capturePage()).toPNG()
            )
            failCopy = false
          }
          await click(`[aria-label="Copy ${name}"]`)
          await waitFor(`document.querySelector('[aria-label="Copy ${name}"] svg.lucide-check')`)
          assert.deepEqual(clipboard.readImage().getSize(), { width, height: 240 })
          await click('[aria-label="Close image preview"]')
          await waitFor('!document.querySelector(".image-lightbox")')
        }
        assert.equal(writes, 2)
        console.log(
          'Progress image copies after scrolling, thumbnail removal, visible errors, and retries passed.'
        )
      } finally {
        window.destroy()
      }
      app.quit()
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
