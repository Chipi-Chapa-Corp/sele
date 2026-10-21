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
      preferencesApi: {
        getItem: (key) => ({ ok: true, value: stored.get(key) ?? null }),
        setItem: (key, value) => {
          stored.set(key, value)
          return { ok: true, value: null }
        },
        removeItem: (key) => {
          stored.delete(key)
          return { ok: true, value: null }
        }
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

test('usage badges default to short and long and all toggle combinations survive reload', () => {
  const { settings } = setup()
  const plain = (value) => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(settings.readStoredAppSettings().chat.displayUsage), {
    context: false,
    short: true,
    long: true
  })
  for (let mask = 0; mask < 8; mask++) {
    const displayUsage = {
      context: Boolean(mask & 1),
      short: Boolean(mask & 2),
      long: Boolean(mask & 4)
    }
    const defaults = settings.readStoredAppSettings()
    settings.writeStoredAppSettings({ ...defaults, chat: { ...defaults.chat, displayUsage } })
    assert.deepEqual(plain(settings.readStoredAppSettings().chat.displayUsage), displayUsage)
    settings.writeStoredAppProjectSettings({ '/workspace': { chat: { displayUsage } } })
    assert.deepEqual(
      plain(
        settings.resolveAppSettings(
          settings.defaultAppSettings,
          settings.readStoredAppProjectSettings()['/workspace']
        ).chat.displayUsage
      ),
      displayUsage
    )
  }
})

test('legacy usage selections migrate to the new independent toggles', () => {
  const { settings, stored } = setup()
  for (const [legacy, expected] of [
    ['short', { context: false, short: true, long: true }],
    ['weekly', { context: false, short: false, long: true }],
    ['chatContext', { context: true, short: false, long: false }]
  ]) {
    stored.set(settings.appSettingsStorageKey, JSON.stringify({ chat: { displayUsage: legacy } }))
    assert.equal(
      JSON.stringify(settings.readStoredAppSettings().chat.displayUsage),
      JSON.stringify(expected)
    )
  }
})
