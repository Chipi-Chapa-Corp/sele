const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

if (process.versions.electron) {
  const { app, BrowserWindow, dialog } = require('electron')
  const [directory, mode] = process.argv.slice(2)
  app.setPath('userData', path.join(directory, 'profile'))
  process.env.SELE_DATABASE_PATH = path.join(directory, 'profile', 'sele.sqlite')
  app.disableHardwareAcceleration()
  const containerName = fs.existsSync('/run/.containerenv')
    ? fs.readFileSync('/run/.containerenv', 'utf8').match(/^name="(.+)"$/m)?.[1]
    : null
  if (containerName) {
    process.env.CONTAINER_TOOL = 'podman'
    process.env.CONTAINER_NAME = containerName
  }
  const terminalContainer = containerName
    ? { kind: 'container', tool: 'podman', name: containerName }
    : null
  if (mode.startsWith('terminal')) {
    const os = require('node:os')
    const userInfo = os.userInfo
    os.userInfo = () => ({ ...userInfo(), shell: '/bin/sh' })
    const pty = require('@lydell/node-pty')
    const spawn = pty.spawn
    let pending = 0
    pty.spawn = (...args) => {
      const terminal = spawn(...args)
      pending++
      terminal.onExit(() => pending--)
      return terminal
    }
    app.on('will-quit', () =>
      assert.equal(pending, 0, 'Quit before native PTY exit callbacks completed')
    )
  }
  const timeout = setTimeout(() => {
    console.error('Built application did not finish')
    app.exit(1)
  }, 15000)
  dialog.showErrorBox = (title, message) => {
    console.error(title, message)
    app.exit(1)
  }
  const fail = (error) => {
    console.error(error)
    app.exit(1)
  }
  process.on('uncaughtException', fail)
  process.on('unhandledRejection', fail)
  const loadFile = BrowserWindow.prototype.loadFile
  // Use the real main entry and preload, with a renderer fixture that never starts
  // provider sessions or reads the developer's accounts.
  BrowserWindow.prototype.loadURL = BrowserWindow.prototype.loadFile = function () {
    return loadFile.call(this, path.join(directory, 'index.html'))
  }
  app.on('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', async () => {
      try {
        if (mode === 'first') {
          await window.webContents.executeJavaScript(
            'localStorage.setItem(\'sele:app-settings:v1\', \'{"theme":"dark"}\')'
          )
        } else assert.equal(await window.webContents.executeJavaScript('localStorage.length'), 0)
        await window.webContents.executeJavaScript('fixture.initializePreferences()')
        assert.equal(
          await window.webContents.executeJavaScript(
            "fixture.preferences.getItem('sele:app-settings:v1')"
          ),
          '{"theme":"dark"}'
        )
        if (mode === 'first') {
          await window.webContents.executeJavaScript(
            "fixture.preferences.setItem('sele:test', 'committed'); fixture.flushPreferences()"
          )
          // Terminate without graceful shutdown: successful IPC must already be durable.
          console.log('COMMITTED')
          process.kill(process.pid, 'SIGKILL')
        } else {
          assert.equal(
            await window.webContents.executeJavaScript("fixture.preferences.getItem('sele:test')"),
            'committed'
          )
          if (mode.startsWith('terminal')) {
            await window.webContents.executeJavaScript(`Promise.all(Array.from({length: 8}, () => new Promise((resolve, reject) => {
              const sessionId = crypto.randomUUID()
              let output = ''
              const off = terminalApi.onData(event => {
                if (event.sessionId === sessionId) output += event.data
                if (event.sessionId === sessionId && output.includes('READY\\r\\n')) { off(); resolve() }
              })
              terminalApi.createSession({sessionId, cwd: ${JSON.stringify(directory)}, cols: 80, rows: 24,
                container: ${JSON.stringify(terminalContainer)}, }).then(() => terminalApi.write(sessionId, 'trap "" HUP; echo READY; exec /bin/sleep 30\\n')).catch(reject)
            })))`)
          }
          console.log('BUILT APP PREFERENCES PASSED', mode)
          await window.webContents.executeJavaScript(
            `fixture.stageDeferredPreference(${JSON.stringify(mode)})`
          )
          clearTimeout(timeout)
          if (mode === 'terminal-close') window.close()
          else app.quit()
          // A second quit request must not bypass cleanup already in progress.
          if (mode.startsWith('terminal')) app.quit()
        }
      } catch (error) {
        fail(error)
      }
    })
  })
  if (mode === 'first') {
    const Database = require('better-sqlite3')
    const { openPreferences } = require(path.join(directory, 'storage.cjs'))
    const db = new Database(':memory:')
    const preferences = openPreferences(db)
    assert.throws(() => preferences.migrate({ 'sele:valid': 'keep', invalid: 'reject' }))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM preferences').get().n, 0)
    assert.deepEqual(preferences.migrate({ 'sele:valid': 'keep' }), { 'sele:valid': 'keep' })
    assert.deepEqual(preferences.migrate({}), { 'sele:valid': 'keep' })
    assert.throws(() => preferences.setMany({ 'sele:valid': 'replace', invalid: 'reject' }))
    assert.equal(preferences.get('sele:valid'), 'keep', 'invalid batches roll back atomically')
    db.pragma('query_only = ON')
    assert.throws(() => preferences.set('sele:valid', 'replace'), /readonly/)
    assert.equal(preferences.get('sele:valid'), 'keep')
    db.close()
  }
  require(path.resolve('out/main/index.js'))
} else {
  ;(async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sele-sqlite-preferences-'))
    const children = []
    try {
      await require('esbuild').build({
        stdin: {
          contents: `
            export * from './src/renderer/src/preferences'
            import { preferences } from './src/renderer/src/preferences'
            import { createAfterPaintWriter } from './src/renderer/src/afterPaintWriter'
            const writer = createAfterPaintWriter(value => preferences.setItem('sele:deferred-close', value))
            export const stageDeferredPreference = value => writer.schedule(value)
          `,
          resolveDir: process.cwd(),
          loader: 'ts'
        },
        outfile: path.join(directory, 'fixture.js'),
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'fixture'
      })
      await require('esbuild').build({
        entryPoints: ['src/main/database/preferences.ts'],
        outfile: path.join(directory, 'storage.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs'
      })
      fs.writeFileSync(
        path.join(directory, 'index.html'),
        '<html><body><script src="fixture.js"></script></body></html>'
      )
      for (const mode of [
        'first',
        'reopen',
        ...(process.platform === 'linux' ? ['terminal', 'terminal-close'] : []),
        'dev',
        'corrupt'
      ]) {
        fs.rmSync(path.join(directory, 'profile', 'Local Storage'), {
          force: true,
          recursive: true
        })
        const databasePath = path.join(directory, 'profile', 'sele.sqlite')
        const corruptData = Buffer.from('deliberately invalid SQLite fixture')
        if (mode === 'corrupt') fs.writeFileSync(databasePath, corruptData)
        const env = {
          ...process.env,
          ELECTRON_ENTRY: __filename,
          ELECTRON_CLI_ARGS: JSON.stringify([directory, mode, '--no-sandbox'])
        }
        delete env.ELECTRON_RUN_AS_NODE
        const child =
          mode === 'dev'
            ? spawn(
                process.execPath,
                [
                  path.resolve('node_modules/electron-vite/bin/electron-vite.js'),
                  'dev',
                  '--entry',
                  __filename,
                  '--',
                  directory,
                  mode,
                  '--no-sandbox'
                ],
                { env, stdio: ['ignore', 'pipe', 'pipe'] }
              )
            : spawn(require('electron'), [__filename, directory, mode, '--no-sandbox'], {
                env,
                stdio: ['ignore', 'pipe', 'pipe']
              })
        children.push(child)
        let output = ''
        child.stdout.on('data', (chunk) => {
          output += chunk
        })
        child.stderr.on('data', (chunk) => {
          output += chunk
        })
        const timer = setTimeout(() => child.kill('SIGKILL'), 30000)
        const result = await new Promise((resolve, reject) => {
          child.on('error', reject)
          child.on('close', (code, signal) => resolve({ code, signal }))
        })
        clearTimeout(timer)
        if (mode === 'first') {
          assert.match(output, /COMMITTED/)
          assert.equal(result.signal, 'SIGKILL')
        } else if (mode === 'corrupt') {
          assert.equal(result.code, 1, output)
          assert.match(output, /file is not a database/)
          assert.deepEqual(fs.readFileSync(databasePath), corruptData)
        } else {
          assert.equal(result.code, 0, output)
          assert.match(output, /BUILT APP PREFERENCES PASSED/)
          const persisted = require('node:child_process').spawnSync(
            require('electron'),
            [
              '-e',
              `
              const db = new (require('better-sqlite3'))(process.env.SELE_DATABASE_PATH, {readonly:true});
              process.stdout.write(db.prepare("SELECT value FROM preferences WHERE key = 'sele:deferred-close'").get().value);
              db.close();
            `
            ],
            {
              env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SELE_DATABASE_PATH: databasePath },
              encoding: 'utf8'
            }
          )
          assert.equal(persisted.status, 0, persisted.stderr)
          assert.equal(
            persisted.stdout,
            mode,
            'close/quit flushes deferred preferences before database disposal'
          )
        }
        console.log('Passed:', mode)
      }
      console.log(
        'Built production and dev entry points: migration, committed writes, SIGKILL, restart, Chromium deletion, corruption refusal and terminal shutdown passed'
      )
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
