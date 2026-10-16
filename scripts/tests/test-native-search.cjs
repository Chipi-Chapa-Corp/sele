const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

if (!process.versions.electron) {
  ;(async () => {
    const directory = await fs.mkdtemp(
      path.join(require('node:os').tmpdir(), 'sele-native-search-')
    )
    try {
      await require('esbuild').build({
        entryPoints: [path.join(__dirname, 'fixtures/native-search.tsx')],
        bundle: true,
        platform: 'browser',
        jsx: 'automatic',
        loader: { '.ttf': 'file' },
        define: { 'process.env.NODE_ENV': '"production"' },
        outfile: path.join(directory, 'fixture.js'),
        plugins: [
          {
            name: 'fixture-provider-bridge',
            setup(build) {
              build.onLoad({ filter: /\/providerApi\.ts$/ }, () => ({
                contents:
                  'export const providerApi = new Proxy({}, {get: (_, key) => window.providerApi[key]})',
                loader: 'ts'
              }))
            }
          }
        ]
      })
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
  const { app, BrowserWindow } = require('electron')
  app.setPath('userData', path.join(process.argv[2], 'profile'))
  app.disableHardwareAcceleration()
  app.whenReady().then(async () => {
    let code = 0
    try {
      const win = new BrowserWindow({
        show: false,
        width: 1100,
        height: 800,
        webPreferences: { backgroundThrottling: false }
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
      await run('setQuery("nee"); setQuery("need"); setQuery("needle")')
      await until('!sidebar.loading && sidebar.chats.length === 1')
      assert.equal(await run('requests.length'), 1)
      assert.equal(await run('requests[0].searchTerm'), 'needle')
      assert.equal(await run('sidebar.chats[0].preview'), 'needle')
      await run('document.querySelector("button").click()')
      await until('!sidebar.loading && sidebar.chats.length === 2')
      assert.equal(await run('requests.at(-1).cursor'), 'sidebar-next')
      assert.deepEqual(await run('sidebar.chats.map(chat => chat.id)'), [
        'matching-chat',
        'older-chat'
      ])
      assert.equal(await run('sidebar.hasMore'), false)

      await run('setQuery("stale")')
      await until('!!deferred.sidebar')
      await run('setQuery("fresh")')
      await until('!sidebar.loading && sidebar.chats[0]?.preview === "fresh"')
      await run('deferred.sidebar({chats:[{id:"stale-chat"}],nextCursor:null})')
      await run('new Promise(resolve => requestAnimationFrame(resolve))')
      assert.equal(await run('sidebar.chats.some(chat => chat.id === "stale-chat")'), false)
      assert.equal(await run('sidebar.chats[0].preview'), 'fresh')

      await run('setQuery("error")')
      await until('!sidebar.loading && !!sidebar.error')
      assert.equal(await run('sidebar.chats.length'), 0)
      await run('setQuery("")')
      await until('!sidebar.loading && sidebar.chats.length === 0 && !sidebar.error')
      const before = await run('requests.length')
      await run('setQuery("closing"); setOpen(false)')
      await run('new Promise(resolve => setTimeout(resolve, 300))')
      assert.equal(await run('requests.length'), before)
      assert.equal(await run('sidebar.chats.length'), 0)
      console.log(
        'PASS sidebar search: debounce, pagination, stale responses, errors, clear and close'
      )
    } catch (error) {
      console.error(error)
      code = 1
    }
    app.exit(code)
  })
}
