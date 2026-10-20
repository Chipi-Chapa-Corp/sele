const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'sele-chat-archive-'))
    try {
      await require('esbuild').build({
        entryPoints: [path.join(__dirname, 'fixtures/chat-archive.tsx')],
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'file' },
        define: { 'process.env.NODE_ENV': '"development"' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'fixture-provider-bridge',
            setup(build) {
              build.onResolve({ filter: /\?worker$/ }, (args) => ({
                path: args.path,
                namespace: 'unused-worker'
              }))
              build.onLoad({ filter: /.*/, namespace: 'unused-worker' }, () => ({
                contents:
                  'export default class { constructor() { throw new Error("Unused editor worker") } }',
                loader: 'js'
              }))
              build.onLoad({ filter: /\/providerApi\.ts$/ }, () => ({
                contents:
                  'export const providerApi = new Proxy({}, {get: (_, key) => window.providerApi[key]})',
                loader: 'ts'
              }))
              build.onLoad({ filter: /\/appApi\.ts$/ }, () => ({
                contents:
                  'export const appApi = new Proxy({}, {get: (_, key) => window.appApi[key]})',
                loader: 'ts'
              }))
            }
          }
        ]
      })
      await require('esbuild').build({
        entryPoints: [path.join(__dirname, 'fixtures/imported-history-backend.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: path.join(directory, 'backend.cjs')
      })
      await fs.writeFile(
        path.join(directory, 'preload.cjs'),
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('archiveFixtureApi',{read:()=>ipcRenderer.invoke('fixture:large-import'),working:id=>ipcRenderer.invoke('fixture:archive-working',id)})`
      )
      await fs.writeFile(
        path.join(directory, 'index.html'),
        '<!doctype html><html data-color-scheme="dark"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>'
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const result = require('node:child_process').spawnSync(
        require('electron'),
        [__filename, directory, '--no-sandbox'],
        { env, encoding: 'utf8', timeout: 30000 }
      )
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) {
        process.stderr.write(result.stderr || String(result.error))
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
  const { app, BrowserWindow, ipcMain } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    try {
      const backend = require(
        path.join(process.argv[2], 'backend.cjs')
      ).createImportedHistoryFixture()
      ipcMain.handle('fixture:large-import', () => backend.read())
      ipcMain.handle('fixture:archive-working', (_event, id) => backend.working(id))
      const win = new BrowserWindow({
        show: true,
        width: 1300,
        height: 900,
        webPreferences: {
          backgroundThrottling: false,
          preload: path.join(process.argv[2], 'preload.cjs')
        }
      })
      win.webContents.on('console-message', (details) => {
        if (details.level === 'error') console.error(details.message)
      })
      await win.loadFile(path.join(process.argv[2], 'index.html'))
      const run = async (source) => {
        try {
          return await win.webContents.executeJavaScript(source)
        } catch (error) {
          throw new Error(`Fixture failed at ${source}: ${error.message}`)
        }
      }
      const until = async (condition) => {
        for (let attempts = 0; attempts < 100; attempts++) {
          if (await run(condition)) return
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        throw new Error(`Timed out: ${condition}`)
      }
      await until('window.ready')
      const click = async (label) =>
        run(`document.querySelector('[aria-label="${label}"]').click()`)
      const choose = async (label) =>
        run(
          `Array.from(document.querySelectorAll('[role="option"]')).find(node => node.textContent.trim() === '${label}').click()`
        )
      assert.deepEqual(
        await run(
          "Array.from(document.querySelectorAll('.chat-home__actions-right button')).map(button => button.getAttribute('aria-label'))"
        ),
        ['New chat', 'Import chat', 'Search conversations']
      )
      await click('Chat menu')
      await until("document.querySelector('.ui-dropdown__action')")
      assert.deepEqual(
        await run(
          "Array.from(document.querySelectorAll('.ui-dropdown__action')).map(node => node.textContent.trim())"
        ),
        ['Pin', 'Export']
      )
      await run(
        "Array.from(document.querySelectorAll('.ui-dropdown__action')).find(node => node.textContent.trim() === 'Export').click()"
      )
      await until("calls.some(call => call.export === 'original')")
      await until('!document.querySelector(\'[aria-label="Chat menu"]\').disabled')
      assert.equal(await run("document.body.textContent.includes('Exported to')"), false)
      await click('Import chat')
      await until(
        "document.querySelector('dialog[open]') && !document.querySelector('[aria-label=\"Import provider\"]').disabled"
      )
      assert.deepEqual(
        await run(
          "Array.from(document.querySelectorAll('dialog button[aria-label]')).map(button => button.getAttribute('aria-label'))"
        ),
        ['Import environment', 'Import provider']
      )
      assert.equal(
        await run("document.querySelector('dialog').textContent.includes('1 turn')"),
        true
      )
      assert.equal(
        await run("document.querySelector('dialog').textContent.includes('Original provider:')"),
        false
      )
      await click('Import provider')
      await until('document.querySelector(\'dialog [role="option"]\')')
      assert.equal(
        await run('document.querySelector(\'dialog [role="option"]\').textContent.trim()'),
        'Codex'
      )
      await run(
        "document.querySelector('[aria-label=\"Import provider\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
      )
      await click('Import environment')
      await until(
        "Array.from(document.querySelectorAll('[role=\"option\"]')).some(node => node.textContent.trim() === 'dev')"
      )
      await choose('Build server')
      await until(
        `document.querySelector('[aria-label="Import provider"]').textContent.includes('No providers available')`
      )
      assert.equal(
        await run(`document.querySelector('[aria-label="Import provider"]').disabled`),
        true
      )
      assert.equal(
        await run(
          `Array.from(document.querySelectorAll('dialog button')).find(node => node.textContent === 'Import').disabled`
        ),
        true
      )
      assert.equal(
        await run(
          `document.querySelector('dialog').textContent.includes('No providers are available in this environment.')`
        ),
        false
      )
      assert.equal(
        await run(
          `document.querySelector('dialog').textContent.includes('Tool history is preserved.')`
        ),
        false
      )
      await click('Import environment')
      await choose('dev')
      await until('!document.querySelector(\'[aria-label="Import provider"]\').disabled')
      await click('Import provider')
      await until('document.querySelector(\'dialog [role="option"]\')')
      await until('document.querySelectorAll(\'dialog [role="option"]\').length === 1')
      assert.deepEqual(
        await run(
          'Array.from(document.querySelectorAll(\'dialog [role="option"]\')).map(node => node.textContent.trim())'
        ),
        ['Claude']
      )
      await until('document.querySelectorAll(\'dialog [role="option"]\').length === 1')
      await choose('Claude')
      assert.equal(await run('calls.some(call => call.import)'), false)
      await run(
        "Array.from(document.querySelectorAll('dialog button')).find(node => node.textContent === 'Import').click()"
      )
      await until('calls.some(call => call.import)')
      await until('document.querySelector("dialog .app-loading-spinner")')
      const firstTransform = await run(
        'getComputedStyle(document.querySelector("dialog .app-loading-spinner")).transform'
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.notEqual(
        await run(
          'getComputedStyle(document.querySelector("dialog .app-loading-spinner")).transform'
        ),
        firstTransform
      )
      await until(
        "document.querySelector('dialog [role=\"status\"]')?.textContent.includes('Importing into')"
      )
      assert.equal(await run('calls.at(-1).providerId'), 'claude')
      assert.deepEqual(await run('calls.at(-1).container'), {
        kind: 'container',
        tool: 'podman',
        name: 'dev'
      })
      assert.equal(
        await run('document.querySelector(\'[aria-label="Import environment"]\').disabled'),
        true
      )
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      await fs.mkdir(path.resolve('test-results/chat-archive'), { recursive: true })
      await fs.writeFile(
        path.resolve('test-results/chat-archive/importing.png'),
        (await win.webContents.capturePage()).toPNG()
      )
      await run(
        "Array.from(document.querySelectorAll('dialog button')).find(node => node.textContent === 'Cancel').click()"
      )
      await until("!document.querySelector('dialog')")
      await run('completeImport()')
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(await run('selected.id'), 'original')
      assert.equal(await run("groups.some(group => group.kind === 'imported')"), false)
      await click('Import chat')
      await until(
        "document.querySelector('dialog[open]') && !document.querySelector('[aria-label=\"Import provider\"]').disabled"
      )
      await click('Import provider')
      await choose('Copilot')
      assert.equal(await run('calls.filter(call => call.import).length'), 1)
      await run(
        "Array.from(document.querySelectorAll('dialog button')).find(node => node.textContent === 'Import').click()"
      )
      await until("calls.at(-1).providerId === 'copilot'")
      await run('completeImport()')
      await until("selected.id.startsWith('imported-')")
      assert.equal(await run('selected.providerId'), 'copilot')
      assert.equal(
        await run("groups.find(group => group.kind === 'imported').chats[0].id === selected.id"),
        true
      )
      assert.equal(
        await run('document.querySelector(\'[aria-label="Imported chats"]\') !== null'),
        true
      )
      await run("document.querySelector('.chat-detail__tool-group summary').click()")
      await until(
        "document.querySelector('[aria-label=\"Opened chat\"]').textContent.includes('Full archived tool output')"
      )
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      await fs.writeFile(
        path.resolve('test-results/chat-archive/imported.png'),
        (await win.webContents.capturePage()).toPNG()
      )
      await run(
        `openLargeImport(); setTimeout(() => document.querySelector('[aria-label="Responsive control"]').click(), 20)`
      )
      await until(`largeImportReady && document.querySelector('[aria-label="Large import"]')`)
      assert.equal(await run('responsiveClicks'), 1)
      assert.equal(await run('largeImportDetail.items.length'), 30)
      assert.equal(
        await run(
          `document.querySelectorAll('[aria-label="Large import"] .chat-detail__step').length <= 30`
        ),
        true
      )
      assert.equal(await run('JSON.stringify(largeImportDetail).length < 30000'), true)
      assert.equal(backend.stats.largestLimit, 10)
      assert.equal(
        await run(
          'largeImportDetail.items.filter(item => item.type === "working").every(item => item.itemsLoaded === false && item.items.length === 0)'
        ),
        true
      )
      await run(
        `document.querySelector('[aria-label="Large import"] .chat-detail__working-load').click()`
      )
      await until(
        'largeImportDetail.items.some(item => item.type === "working" && item.itemsLoaded !== false && item.items.length > 0)'
      )
      console.log(
        'PASS Large import UI: 6,000 turns, bounded native reads, responsive controls, lazy archived tool expansion'
      )
      console.log(
        'PASS Chat archive UI: menu export, preview, environment/provider selection, loading, cancellation, opening and Imported project'
      )
    } catch (error) {
      code = 1
      console.error(error)
    } finally {
      app.exit(code)
    }
  })
}
