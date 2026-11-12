import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { desktopChannels } from '../../shared/desktop.ts'

const require = createRequire(import.meta.url)
const bundle = await build({
  stdin: {
    contents:
      "export * from './src/main/desktop/registerDesktopIpc';export * from './src/main/desktop/ChromeAutomation'",
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  external: ['sele-desktop-host'],
  write: false,
  plugins: [
    {
      name: 'desktop-host',
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'fixture'
        }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            "const host=require('sele-desktop-host');export const app=host.app;export const safeStorage=host.safeStorage;export const shell=host.shell;"
        }))
        build.onResolve(
          { filter: /^electron$|^\.\.\/logging$|ComputerAutomation$|CodexBrowserBridge$/ },
          ({ path }) => ({ path, external: true })
        )
      }
    }
  ]
})

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sele-dual-browser-'))
  const handlers = new Map()
  const bridges = []
  const module = { exports: {} }
  const load = (id) => {
    if (id === 'sele-desktop-host')
      return {
        app: { getPath: () => directory, once() {} },
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (v) => Buffer.from(v),
          decryptString: (v) => v.toString()
        }
      }
    if (id === '../logging')
      return { handleLoggedIpc: (name, callback) => handlers.set(name, callback) }
    if (id.endsWith('ComputerAutomation'))
      return {
        computerAutomation: {
          status: { connected: false, connecting: false, backend: null, error: null }
        }
      }
    if (id.endsWith('CodexBrowserBridge'))
      return {
        startBrowserUseBridge: async (_service, identity) => {
          bridges.push(identity)
          return async () => {}
        }
      }
    return require(id)
  }
  vm.runInThisContext(`(function(module,exports,require){${bundle.outputFiles[0].text}\n})`)(
    module,
    module.exports,
    load
  )
  const api = module.exports
  api.configureChromePairingStorage(directory)
  t.after(async () => {
    await Promise.all([api.chromeAutomation.close(), api.operaAutomation.close()])
    await rm(directory, { recursive: true, force: true })
  })
  const call = (channel) => handlers.get(channel)()
  return { api, directory, bridges, call }
}

test('settings pair and disconnect Opera without rotating an active Chrome binding', async (t) => {
  const { api, directory, bridges, call } = await fixture(t)
  await api.chromeAutomation.pair()
  const address = api.chromeAutomation.status.pairingUrl
  const binding = join(directory, 'desktop-chrome', 'pairing.enc.json')
  const saved = await readFile(binding)
  const extension = new WebSocket(`${address}&epoch=00000000-0000-4000-8000-000000000001`, {
    origin: `chrome-extension://${'a'.repeat(32)}`
  })
  await once(extension, 'open')
  api.registerDesktopIpc()
  const paired = await call(desktopChannels.pairOpera)
  assert.equal(paired.chrome.connected, true)
  assert.equal(paired.chrome.pairingUrl, address)
  assert.ok(paired.opera.pairingUrl)
  assert.notEqual(paired.opera.pairingUrl, address)
  assert.deepEqual(await readFile(binding), saved)
  assert.deepEqual(bridges.map((bridge) => bridge.name).sort(), [
    'Chrome (Sele extension)',
    'Opera (Sele extension)'
  ])
  assert.equal(bridges.find((bridge) => bridge.name.startsWith('Opera')).endpointId, 'opera')
  const disconnected = await call(desktopChannels.disconnectOpera)
  assert.equal(disconnected.opera.pairingUrl, null)
  assert.equal(disconnected.chrome.connected, true)
  assert.equal(disconnected.chrome.pairingUrl, address)
  assert.deepEqual(await readFile(binding), saved)
})

test('an Opera restore error stays visible while Chrome restores; Opera can repair its own pairing', async (t) => {
  const { api, directory, call } = await fixture(t)
  await api.chromeAutomation.pair()
  const chromeAddress = api.chromeAutomation.status.pairingUrl
  await api.operaAutomation.pair()
  const operaAddress = api.operaAutomation.status.pairingUrl
  await Promise.all([api.chromeAutomation.close(), api.operaAutomation.close()])
  const blocker = createServer()
  blocker.listen(Number(new URL(operaAddress).port), '127.0.0.1')
  await once(blocker, 'listening')
  t.after(() => new Promise((resolve) => blocker.close(resolve)))
  api.registerDesktopIpc()
  const restored = await call(desktopChannels.getState)
  assert.equal(restored.chrome.pairingUrl, chromeAddress)
  assert.equal(restored.chrome.error, null)
  assert.equal(restored.opera.pairingUrl, null)
  assert.match(restored.opera.error, /EADDRINUSE|already in use/)
  const saved = await readFile(join(directory, 'desktop-chrome', 'pairing.enc.json'))
  const repaired = await call(desktopChannels.pairOpera)
  assert.equal(repaired.opera.error, null)
  assert.ok(repaired.opera.pairingUrl)
  assert.notEqual(repaired.opera.pairingUrl, operaAddress)
  assert.equal(repaired.chrome.pairingUrl, chromeAddress)
  assert.deepEqual(await readFile(join(directory, 'desktop-chrome', 'pairing.enc.json')), saved)
})
