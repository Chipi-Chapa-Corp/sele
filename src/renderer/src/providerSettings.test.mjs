import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const exports = {}
const storage = new Map()
vm.runInNewContext(
  ts.transpile(readFileSync(new URL('./providerSettings.ts', import.meta.url), 'utf8'), {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }),
  {
    exports,
    console,
    require: (name) =>
      name.includes('preferences')
        ? {
            preferences: {
              getItem: (key) => storage.get(key) ?? null,
              setItem: (key, value) => storage.set(key, value)
            }
          }
        : {
            isProviderId: (id) => ['codex', 'claude', 'copilot', 'opencode-v2'].includes(id),
            fallbackClaudeModels: [],
            fallbackCopilotModels: [],
            fallbackOpenCodeModels: [],
            fallbackProviderModels: []
          }
  }
)
const {
  expandProviderUpdateSuggestions: expand,
  getProviderUpdateKey: key,
  getProviderUpdatePreferenceKey: preferenceKey,
  shouldSuggestProviderUpdate: shouldSuggest
} = exports
const plain = (value) => JSON.parse(JSON.stringify(value))

test('all provider releases produce independent update suggestions', () => {
  const versions = { currentVersion: '2.1.0', latestVersion: '2.2.0' }
  const items = ['codex', 'claude', 'opencode-v2'].flatMap((id) => expand(id, versions))
  assert.equal(new Set(items.map(key)).size, 3)
  assert.equal(expand('opencode-v2', { ...versions, currentVersion: '2.2.0' }).length, 0)
  assert.equal(expand('opencode-v2', null).length, 0)
  assert.equal(
    shouldSuggest(
      { 'opencode-v2': { neverSuggest: true, ignoredVersions: [] } },
      preferenceKey(items[2]),
      items[2]
    ),
    false
  )
  assert.equal(shouldSuggest({}, 'opencode-v2', versions), true)
})
test('v1 update and migration preferences are discarded', () => {
  const preferences = {
    opencode: { neverSuggest: true, ignoredVersions: ['1.19.5'] },
    'opencode-migration': { neverSuggest: true, ignoredVersions: ['2.2.0'] },
    'opencode-v2': { neverSuggest: false, ignoredVersions: ['2.1.0'] }
  }
  exports.writeStoredProviderUpdatePreferences(preferences)
  assert.deepEqual(plain(exports.readStoredProviderUpdatePreferences()), {
    'opencode-v2': preferences['opencode-v2']
  })
})
test('stale provider IDs cannot produce update suggestions', () => {
  const versions = { currentVersion: '1.19.5', latestVersion: '2.2.0' }
  for (const id of ['opencode', 'opencode-migration', 'unknown']) {
    assert.deepEqual(plain(expand(id, versions)), [])
  }
})
test('OpenCode is a single v2 provider with an unversioned display name', () => {
  assert.equal(exports.providerLabels['opencode-v2'], 'OpenCode')
  assert.equal(exports.providerLabels.opencode, undefined)
  const source = ts.createSourceFile(
    'provider.ts',
    readFileSync(new URL('../../shared/provider.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements
    .flatMap((node) => (ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []))
    .find((node) => node.name.getText(source) === 'providerIds')
  assert.equal(
    declaration.initializer.expression.elements.filter((node) => node.text.includes('opencode'))
      .length,
    1
  )
  assert.equal(
    declaration.initializer.expression.elements.find((node) => node.text.includes('opencode')).text,
    'opencode-v2'
  )
})
