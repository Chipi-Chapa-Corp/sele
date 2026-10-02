import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const bundled = await build({
  entryPoints: [new URL('./settings.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
})
const setup = () => {
  const stored = new Map()
  const module = { exports: {} }
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    console,
    window: {
      localStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: (key) => stored.delete(key)
      }
    }
  })
  return { settings: module.exports, stored }
}

test('new and existing settings default to ten retries every two seconds', () => {
  const { settings, stored } = setup()
  assert.equal(settings.readStoredAppSettings().chat.networkRetryCount, 10)
  assert.equal(settings.readStoredAppSettings().chat.networkRetryDelaySeconds, 2)
  stored.set(settings.appSettingsStorageKey, JSON.stringify({ chat: { hidePlans: true } }))
  const loaded = settings.readStoredAppSettings()
  assert.equal(loaded.chat.networkRetryCount, 10)
  assert.equal(loaded.chat.networkRetryDelaySeconds, 2)
  assert.equal(loaded.chat.hidePlans, true)
})

test('custom retry settings survive saving and reloading, including zero to disable', () => {
  const { settings } = setup()
  for (const count of [7, 0]) {
    const defaults = settings.readStoredAppSettings()
    settings.writeStoredAppSettings({
      ...defaults,
      chat: { ...defaults.chat, networkRetryCount: count, networkRetryDelaySeconds: 1.5 }
    })
    const loaded = settings.readStoredAppSettings()
    assert.equal(loaded.chat.networkRetryCount, count)
    assert.equal(loaded.chat.networkRetryDelaySeconds, 1.5)
  }
  settings.writeStoredAppSettings(settings.defaultAppSettings)
  assert.equal(settings.readStoredAppSettings().chat.networkRetryCount, 10)
  assert.equal(settings.readStoredAppSettings().chat.networkRetryDelaySeconds, 2)
})

test('project overrides persist and inherit unspecified global retry settings', () => {
  const { settings } = setup()
  settings.writeStoredAppProjectSettings({ '/workspace': { chat: { networkRetryCount: 3 } } })
  const projects = settings.readStoredAppProjectSettings()
  const effective = settings.resolveAppSettings(settings.defaultAppSettings, projects['/workspace'])
  assert.equal(effective.chat.networkRetryCount, 3)
  assert.equal(effective.chat.networkRetryDelaySeconds, 2)
  settings.writeStoredAppProjectSettings({
    '/workspace': { chat: { networkRetryCount: 0, networkRetryDelaySeconds: 0.5 } }
  })
  const reloaded = settings.readStoredAppProjectSettings()['/workspace'].chat
  assert.equal(reloaded.networkRetryCount, 0)
  assert.equal(reloaded.networkRetryDelaySeconds, 0.5)
})

test('invalid stored retry settings fall back to defaults and stay within supported bounds', () => {
  const { settings, stored } = setup()
  stored.set(
    settings.appSettingsStorageKey,
    JSON.stringify({ chat: { networkRetryCount: 'invalid', networkRetryDelaySeconds: null } })
  )
  assert.equal(settings.readStoredAppSettings().chat.networkRetryCount, 10)
  assert.equal(settings.readStoredAppSettings().chat.networkRetryDelaySeconds, 2)
  stored.set(
    settings.appSettingsStorageKey,
    JSON.stringify({ chat: { networkRetryCount: -2, networkRetryDelaySeconds: -5 } })
  )
  assert.equal(settings.readStoredAppSettings().chat.networkRetryCount, 0)
  assert.equal(settings.readStoredAppSettings().chat.networkRetryDelaySeconds, 0.1)
})
