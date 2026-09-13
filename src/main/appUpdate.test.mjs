import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { isNewerStableVersion } from '../shared/appUpdate.ts'

const require = createRequire(import.meta.url)
const source = ts.transpileModule(
  readFileSync(new URL('./appUpdate.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }
).outputText
const settle = () => new Promise((resolve) => setImmediate(resolve))

function harness({
  packaged = true,
  preferences = {},
  downloadError = false,
  flatpak = false,
  flatpakFailure = false,
  flatpakRoot = '/var/lib/flatpak',
  installed = true
} = {}) {
  const commands = []
  const commit = 'a'.repeat(64)
  const handlers = {}
  let tick
  let checks = 0
  let downloads = 0
  let restarts = 0
  let saved
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => {
      checks++
      return { isUpdateAvailable: true, updateInfo: { version: '2.14.0' } }
    },
    downloadUpdate: async () => {
      downloads++
      if (downloadError) throw new Error('Download failed')
    },
    quitAndInstall: () => {
      restarts++
    }
  })
  const app = Object.assign(new EventEmitter(), {
    isPackaged: packaged,
    getVersion: () => '2.13.0',
    getPath: () => '/test',
    quit: () => {
      restarts++
    }
  })
  const channels = Object.fromEntries(
    ['getAppUpdate', 'dismissAppUpdate', 'installAppUpdate', 'appUpdateChanged'].map((key) => [
      key,
      key
    ])
  )
  const mocks = {
    electron: { app, BrowserWindow: { getAllWindows: () => [] } },
    'electron-updater': { autoUpdater: updater },
    'node:fs': {
      existsSync: (path) =>
        path === '/.flatpak-info' ? flatpak : installed && path.endsWith('Uninstall Sele.exe')
    },
    'node:child_process': {
      execFile: (_file, args, _options, callback) => {
        commands.push(args)
        if (flatpakFailure && args.includes('update'))
          return callback(new Error('Flatpak update failed'))
        const stdout = args.includes('--show-origin') ? 'sele' : commit
        callback(null, { stdout })
      },
      spawn: (_file, args) => {
        commands.push(args)
        const child = new EventEmitter()
        setImmediate(() => child.emit('exit', 0))
        return child
      }
    },
    'node:fs/promises': {
      readFile: async (path) =>
        path === '/.flatpak-info'
          ? `app-path=${flatpakRoot}/app/com.chipichapa.sele/x86_64/stable/old/files
arch=x86_64
branch=stable
instance-id=1234
app-commit=${'b'.repeat(64)}`
          : JSON.stringify(preferences),
      writeFile: async (_, value) => {
        saved = JSON.parse(value)
      }
    },
    './logging': {
      handleLoggedIpc: (channel, callback) => {
        handlers[channel] = callback
      }
    },
    '../shared/app': { appIpcChannels: channels },
    '../shared/appUpdate': { isNewerStableVersion }
  }
  const context = {
    exports: {},
    require: (name) => mocks[name] ?? require(name),
    process: { platform: flatpak ? 'linux' : 'win32' },
    AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ tag_name: 'v2.14.0' }) }),
    console: { error: () => {} },
    setInterval: (callback, delay) => {
      assert.equal(delay, 300000)
      tick = callback
      return {
        unref() {
          /* The test owns this timer. */
        }
      }
    },
    clearInterval() {
      /* No real timer is scheduled. */
    }
  }
  vm.runInNewContext(source, context)
  context.exports.registerAppUpdate()
  return {
    commands,
    updater,
    state: () => handlers.getAppUpdate(),
    tick: () => tick(),
    dismiss: (mode) => handlers.dismissAppUpdate(null, mode),
    install: () => handlers.installAppUpdate(),
    counts: () => ({ checks, downloads, restarts }),
    saved: () => saved
  }
}

test('compares stable semantic versions without downgrades or prereleases', () => {
  assert.equal(isNewerStableVersion('v2.14.0', '2.13.0'), true)
  for (const version of ['2.13.0', '2.9.99', '2.14.0-beta.1', 'oops']) {
    assert.equal(isNewerStableVersion(version, '2.13.0'), false)
  }
})

test('checks at startup and every five minutes without downloading; skip lasts this session', async () => {
  const h = harness()
  await settle()
  assert.equal(h.state().version, '2.14.0')
  assert.deepEqual(h.counts(), { checks: 1, downloads: 0, restarts: 0 })
  await h.dismiss('session')
  h.tick()
  await settle()
  assert.equal(h.state().version, null)
  assert.equal(h.counts().checks, 2)
})

test('persistent dismissal survives startup and rejects invalid modes', async () => {
  const h = harness()
  await settle()
  await assert.rejects(h.dismiss('invalid'))
  await h.dismiss('version')
  const next = harness({ preferences: h.saved() })
  await settle()
  assert.equal(next.state().version, null)
  const disabled = harness({ preferences: { disabled: true } })
  await settle()
  disabled.tick()
  assert.equal(disabled.counts().checks, 0)
})

test('only an explicit update downloads and restarts; failures retain a retryable prompt', async () => {
  const h = harness()
  await settle()
  await h.install()
  assert.deepEqual(h.counts(), { checks: 1, downloads: 1, restarts: 1 })
  assert.equal(h.updater.autoDownload, false)
  assert.equal(h.updater.autoInstallOnAppQuit, false)
  const failing = harness({ downloadError: true })
  await settle()
  await failing.install()
  assert.equal(failing.state().status, 'error')
  assert.equal(failing.state().version, '2.14.0')
  assert.equal(failing.counts().restarts, 0)
  await failing.install()
  assert.equal(failing.counts().downloads, 2)
})

test('development builds never check or install', async () => {
  const h = harness({ packaged: false })
  await settle()
  h.tick()
  await h.install()
  assert.deepEqual(h.counts(), { checks: 0, downloads: 0, restarts: 0 })
})

test('Flatpak updates the installed scope and exact commit before scheduling a fresh sandbox', async () => {
  const h = harness({ flatpak: true })
  await settle()
  assert.equal(h.state().version, '2.14.0')
  await h.install()
  const update = h.commands.find((args) => args.includes('update'))
  assert.ok(update.includes('--system'))
  assert.ok(update.includes(`--commit=${'a'.repeat(64)}`))
  assert.ok(update.includes('app/com.chipichapa.sele/x86_64/stable'))
  assert.ok(h.commands.at(-1).includes('1234'))
  assert.equal(h.counts().restarts, 1)
})

test('Flatpak installation failure never schedules a restart', async () => {
  const h = harness({ flatpak: true, flatpakFailure: true })
  await settle()
  await h.install()
  assert.equal(h.state().status, 'error')
  assert.equal(h.counts().restarts, 0)
  assert.equal(
    h.commands.some((args) => args.includes('sh')),
    false
  )
})

test('unpacked Windows distributions do not offer installer updates', async () => {
  const h = harness({ installed: false })
  await settle()
  assert.equal(h.counts().checks, 0)
})


test('user Flatpak checks, update, verification and restart keep the user scope', async () => {
  const h = harness({ flatpak: true, flatpakRoot: '/home/test/.local/share/flatpak' })
  await settle()
  assert.equal(h.state().version, '2.14.0')
  await h.install()
  assert.ok(h.commands.length > 0)
  for (const args of h.commands) {
    assert.ok(args.includes('--user'))
    assert.equal(args.includes('--system'), false)
  }
  assert.equal(h.counts().restarts, 1)
})
