const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    await fs.mkdir(path.resolve('tmp'), { recursive: true })
    const directory = await fs.mkdtemp(path.resolve('tmp/sele-renderer-hmr-'))
    let server
    try {
      const { createServer } = await import('vite')
      // Exercise the real entry module against a stateful fixture, never real accounts.
      const rendererDirectory = path.resolve('src/renderer/src')
      const bootstrap = (await fs.readFile(path.join(rendererDirectory, 'bootstrap.tsx'), 'utf8'))
        .replace("import './assets/main.css'", '')
        .replace(
          "'./components/RendererErrorBoundary'",
          JSON.stringify(`/@fs/${rendererDirectory}/components/RendererErrorBoundary.tsx`)
        )
        .replace(
          "'./middleClickPaste'",
          JSON.stringify(`/@fs/${rendererDirectory}/middleClickPaste.ts`)
        )
      await fs.writeFile(path.join(directory, 'bootstrap.tsx'), bootstrap)
      await fs.writeFile(
        path.join(directory, 'label.ts'),
        "export const label = 'original helper'\n"
      )
      await fs.writeFile(
        path.join(directory, 'systemColorScheme.ts'),
        await fs.readFile(path.join(rendererDirectory, 'systemColorScheme.ts'), 'utf8')
      )
      await fs.writeFile(
        path.join(directory, 'settings.ts'),
        "export const readStoredAppSettings = () => ({appearance: {theme: 'system'}})\n"
      )
      await fs.writeFile(
        path.join(directory, 'appApi.ts'),
        `
        export const appApi = {
          getColorScheme: async () => {
            window.themeStarts = (window.themeStarts ?? 0) + 1
            return 'light'
          },
          onColorSchemeUpdated: () => {
            window.themeSubscriptions = (window.themeSubscriptions ?? 0) + 1
            return () => { window.themeSubscriptions-- }
          }
        }
      `
      )
      await fs.writeFile(
        path.join(directory, 'useCounter.ts'),
        `import {useState} from 'react'
        export function useCounter() {
          const [selected, setSelected] = useState(0)
          return [selected, setSelected, 'original hook'] as const
        }`
      )
      await fs.writeFile(
        path.join(directory, 'useNestedCounter.tsx'),
        `import {useState} from 'react'
        import {useCounter} from './useCounter'
        export function useNestedCounter() { return useCounter() }`
      )
      await fs.writeFile(
        path.join(directory, 'App.tsx'),
        `
        import {useRef, useState} from 'react'
        import {label} from './label'
        import {useNestedCounter} from './useNestedCounter'
        export function App() {
          const [draft, setDraft] = useState('')
          const [selected, setSelected, hookVersion] = useNestedCounter()
          const marker = useRef(crypto.randomUUID())
          return <main data-marker={marker.current} data-version="original component" data-hook-version={hookVersion}>
            <span id="label">{label}</span>
            <button onClick={() => setSelected(value => value + 1)}>Selected {selected}</button>
            <input value={draft} onChange={event => setDraft(event.target.value)}/>
            <div id="scroll" style={{height:100,overflow:'auto'}}><div style={{height:1000}}>History</div></div>
          </main>
        }
      `
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        `<!doctype html>
        <script>window.documentMarker = crypto.randomUUID()</script>
        <div id="root"></div><script type="module" src="/bootstrap.tsx"></script>`
      )
      const configFile = path.join(directory, 'vite.config.ts')
      await fs.writeFile(
        configFile,
        `import {rendererViteConfig} from ${JSON.stringify(path.resolve('vite.renderer.ts'))}; export default rendererViteConfig`
      )
      server = await createServer({
        configFile,
        root: directory,
        cacheDir: path.join(directory, '.vite'),
        server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd()] } },
        optimizeDeps: {
          include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'motion/react']
        }
      })
      await server.listen()
      const url = `http://127.0.0.1:${server.httpServer.address().port}`
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = require('node:child_process').spawn(
        require('electron'),
        [__filename, directory, url, '--no-sandbox'],
        { env, stdio: 'inherit' }
      )
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code) => resolve(code ?? 1))
      })
    } finally {
      await server?.close()
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
  app.whenReady().then(async () => {
    let code = 0
    try {
      const errors = []
      const win = new BrowserWindow({
        width: 600,
        height: 400,
        webPreferences: { backgroundThrottling: false }
      })
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error' || /createRoot.*already|hook.*order/i.test(details.message)) {
          errors.push(details.message)
        }
      })
      const run = (source) => win.webContents.executeJavaScript(source)
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const waitFor = async (source) => {
        for (let attempt = 0; attempt < 150; attempt++) {
          if (await run(source)) return
          await pause(100)
        }
        throw new Error(`Timed out: ${source}; renderer errors: ${errors.join('\n')}`)
      }
      await win.loadURL(process.argv[3])
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true
      })
      await waitFor(`Boolean(document.querySelector('input'))`)
      await run(`
        document.querySelector('button').click();
        const input = document.querySelector('input');
        input.focus();
      `)
      await win.webContents.debugger.sendCommand('Input.insertText', { text: 'Keep this draft' })
      await waitFor(`document.querySelector('input').value === 'Keep this draft'`)
      await run(
        `document.querySelector('input').setSelectionRange(2, 7); document.querySelector('#scroll').scrollTop = 240`
      )
      const snapshot = () =>
        run(`(() => {
        const input = document.querySelector('input');
        return {
          document: window.documentMarker,
          component: document.querySelector('main').dataset.marker,
          draft: input.value,
          selection: [input.selectionStart, input.selectionEnd],
          focused: document.activeElement === input,
          scroll: document.querySelector('#scroll').scrollTop,
          selected: document.querySelector('button').textContent,
          subscriptions: window.themeSubscriptions
        }
      })()`)
      const before = await snapshot()
      assert.equal(before.selected, 'Selected 1')
      assert.equal(before.focused, true)
      assert.equal(before.subscriptions, 1)

      const appPath = path.join(directory, 'App.tsx')
      await fs.writeFile(
        appPath,
        (await fs.readFile(appPath, 'utf8')).replace('original component', 'updated component')
      )
      await waitFor(`document.querySelector('main')?.dataset.version === 'updated component'`)
      assert.deepEqual(await snapshot(), before, 'component edits preserve state and DOM')

      await fs.writeFile(
        path.join(directory, 'label.ts'),
        "export const label = 'updated helper'\n"
      )
      await waitFor(`document.querySelector('#label')?.textContent === 'updated helper'`)
      assert.deepEqual(await snapshot(), before, 'helper edits preserve state and DOM')

      const bootstrapPath = path.join(directory, 'bootstrap.tsx')
      for (let revision = 1; revision <= 2; revision++) {
        await fs.appendFile(bootstrapPath, `\nwindow.entryRevision = ${revision}\n`)
        await waitFor(`window.entryRevision === ${revision}`)
        assert.deepEqual(
          await snapshot(),
          before,
          'entry edits reuse the mounted root and replace subscriptions'
        )
      }
      assert.equal(await run('window.themeStarts'), 3)
      const hookPath = path.join(directory, 'useCounter.ts')
      await fs.writeFile(
        hookPath,
        (await fs.readFile(hookPath, 'utf8'))
          .replace('return [selected', 'useState(false)\n          return [selected')
          .replace('original hook', 'updated hook')
      )
      await waitFor(`document.querySelector('main')?.dataset.hookVersion === 'updated hook'`)
      assert.equal(
        (await snapshot()).document,
        before.document,
        'hook signature changes do not reload the document'
      )
      assert.notEqual(
        (await snapshot()).component,
        before.component,
        'hook signature changes safely remount their consumer'
      )
      const afterHook = await snapshot()
      const nestedPath = path.join(directory, 'useNestedCounter.tsx')
      await fs.writeFile(
        nestedPath,
        (await fs.readFile(nestedPath, 'utf8')).replace(
          '{ return useCounter()',
          '{ useState(false); return useCounter()'
        )
      )
      await waitFor(
        `document.querySelector('main')?.dataset.marker !== ${JSON.stringify(afterHook.component)}`
      )
      assert.equal(
        (await snapshot()).document,
        before.document,
        'nested hook updates keep the document'
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS: compatible hot updates preserve UI state and subscriptions; .ts and nested hook-only .tsx signature edits safely remount consumers without hook-order errors or a document reload.'
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
