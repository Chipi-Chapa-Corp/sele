import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveProviderModelCatalogFailure,
  resolveProviderModelCatalogSuccess
} from './modelCatalogLoad.ts'
import {
  reconcileModelSelection,
  reconcileReasoningSelection,
  resolveEffectiveModel
} from './modelSelection.ts'
import { selectChatPreferences } from './chatModelPreferences.ts'
import {
  filterOpenCodeModels,
  getOpenCodeProviders,
  readOpenCodeProviderPreferences,
  selectOpenCodeProvider,
  writeOpenCodeProviderPreferences
} from './openCodeProviderPreferences.ts'
import {
  getAccountModelPreferenceKey,
  readAccountModelPreferences,
  writeAccountModelPreferences
} from './accountModelPreferences.ts'

const cachedModels = [{ id: 'cached' }]
const fallbackModels = [{ id: 'fallback' }]
const freshModels = [{ id: 'fresh' }]

test('OpenCode providers distinguish billing connections and filter models by provider ID', () => {
  const models = [
    { id: 'anthropic/claude', modelProvider: { id: 'anthropic', name: 'Anthropic' } },
    { id: 'opencode-go/claude', modelProvider: { id: 'opencode-go', name: 'OpenCode Go' } },
    { id: 'opencode/free', modelProvider: { id: 'opencode', name: 'OpenCode Zen' } }
  ]
  const connections = [
    { id: 'anthropic', name: 'Anthropic', connections: [{ type: 'credential', id: 'anthropic' }] },
    { id: 'unused', name: 'Unused', connections: [] },
    { id: 'disabled', name: 'Disabled', connections: [{ type: 'credential', id: 'disabled' }] }
  ]
  const providers = getOpenCodeProviders(connections, models)
  assert.deepEqual(
    providers.map((provider) => provider.name),
    ['Anthropic', 'Disabled', 'OpenCode Go', 'OpenCode Zen']
  )
  assert.deepEqual(filterOpenCodeModels(models, 'anthropic'), [models[0]])
  assert.deepEqual(filterOpenCodeModels(models, 'opencode-go'), [models[1]])
  assert.deepEqual(filterOpenCodeModels(models, 'disabled'), [])
  assert.equal(selectOpenCodeProvider(providers, 'opencode-go', 'anthropic/claude'), 'opencode-go')
  assert.equal(selectOpenCodeProvider(providers, 'deleted', 'anthropic/claude'), 'anthropic')
  assert.equal(selectOpenCodeProvider([], 'anthropic', 'anthropic/claude'), '')
})

test('OpenCode remembers the selected provider independently per environment across restarts', () => {
  let stored
  const storage = {
    getItem: () => stored ?? null,
    setItem: (_, value) => {
      stored = value
    }
  }
  writeOpenCodeProviderPreferences({ host: 'anthropic', 'podman:dev': 'opencode-go' }, storage)
  assert.deepEqual(readOpenCodeProviderPreferences(storage), {
    host: 'anthropic',
    'podman:dev': 'opencode-go'
  })
  stored = '{"host": 123, "podman:dev": "opencode-go"}'
  assert.deepEqual(readOpenCodeProviderPreferences(storage), { 'podman:dev': 'opencode-go' })
})

test('keeps the last successful model catalog while exposing refresh errors', () => {
  assert.deepEqual(
    resolveProviderModelCatalogFailure(cachedModels, fallbackModels, 'Discovery failed'),
    { models: cachedModels, error: 'Discovery failed', cache: false }
  )
})

test('uses fallback models on an initial failure without caching them as discovery', () => {
  assert.deepEqual(
    resolveProviderModelCatalogFailure(undefined, fallbackModels, 'Discovery failed'),
    { models: fallbackModels, error: 'Discovery failed', cache: false }
  )
})

test('a successful retry replaces the catalog and clears the prior error', () => {
  assert.deepEqual(resolveProviderModelCatalogSuccess(freshModels, fallbackModels), {
    models: freshModels,
    error: null,
    cache: true
  })
})

const auto = {
  id: 'default',
  isDefault: true,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [{ id: 'medium' }]
}
const opus = {
  id: 'opus',
  isDefault: false,
  defaultReasoningEffort: 'high',
  supportedReasoningEfforts: [{ id: 'high' }, { id: 'max' }]
}
const ready = { activeKey: 'claude:host', displayedKey: 'claude:host', loading: false }

test('an explicit model survives unfinished refreshes and discovery failures', () => {
  const chosen = { model: 'opus', manuallySelected: true }
  let selection = chosen
  for (const [models, catalog] of [
    [[], { ...ready, displayedKey: null, loading: true }],
    [[auto], { ...ready, error: 'Discovery failed' }],
    [[auto, opus], ready]
  ]) {
    selection = reconcileModelSelection(models, selection, catalog)
    assert.deepEqual(selection, chosen)
    assert.equal(resolveEffectiveModel(models, selection.model, null), 'opus')
  }
  const stored = JSON.parse(
    JSON.stringify({ claude: { model: selection.model }, codex: { model: 'gpt' } })
  )
  assert.equal(selectChatPreferences({}, stored, 'codex', null).model, 'gpt')
  assert.equal(selectChatPreferences({}, stored, 'claude', null).model, 'opus')
})

test('a confirmed catalog uses an available default when the previous model is absent', () => {
  assert.deepEqual(
    reconcileModelSelection(
      [auto, opus],
      {
        model: 'initial-placeholder',
        manuallySelected: false
      },
      ready
    ),
    { model: 'default', manuallySelected: false }
  )
  assert.deepEqual(
    reconcileModelSelection(
      [opus],
      {
        model: 'default',
        manuallySelected: true
      },
      ready
    ),
    { model: 'opus', manuallySelected: false }
  )
})

test('A to B to A restores account A only because B is unavailable there', () => {
  const a = { id: 'A', isDefault: true }
  const b = { id: 'B', isDefault: true }
  const c = { id: 'C', isDefault: false }
  const aKey = getAccountModelPreferenceKey('claude', 'host', 'default')
  const bKey = getAccountModelPreferenceKey('claude', 'host', 'work')
  const remembered = {}
  let selection = { model: 'A', manuallySelected: true }
  const visit = (key, models) => {
    const sentModel = resolveEffectiveModel(models, selection.model, null, ready, remembered[key])
    selection = reconcileModelSelection(models, selection, ready, remembered[key])
    assert.equal(sentModel, selection.model)
    assert.ok(
      models.some((model) => model.id === sentModel),
      'never send an unavailable model'
    )
    remembered[key] = selection.model
    return selection.model
  }
  assert.equal(visit(aKey, [a]), 'A')
  assert.equal(visit(bKey, [b]), 'B')
  assert.equal(visit(aKey, [a]), 'A')
  assert.equal(visit(bKey, [b, a]), 'A', 'supported current choice beats account B memory')
  selection = { model: 'C', manuallySelected: true }
  assert.equal(visit(bKey, [b, c]), 'C')
  assert.equal(visit(aKey, [a, c]), 'C', 'do not restore A when current C is available')
})

test('unavailable saved models are ignored, and transient catalogs do not select a fallback', () => {
  const chosen = { model: 'B', manuallySelected: true }
  const a = { id: 'A', isDefault: true }
  assert.equal(reconcileModelSelection([a], chosen, ready, 'retired').model, 'A')
  for (const catalog of [
    { ...ready, loading: true },
    { ...ready, displayedKey: 'another-account' },
    { ...ready, error: 'Discovery failed' }
  ]) {
    assert.deepEqual(reconcileModelSelection([auto], chosen, catalog, 'A'), chosen)
  }
  assert.deepEqual(reconcileModelSelection([], chosen, ready, 'A'), chosen)
  assert.deepEqual(
    reconcileModelSelection(
      [a, { id: 'B' }],
      {
        ...chosen,
        manuallySelected: false
      },
      ready,
      'A'
    ),
    { ...chosen, manuallySelected: false }
  )
})

test('account model memory persists and is isolated by provider, environment, and account', () => {
  const keys = [
    getAccountModelPreferenceKey('claude', 'host', 'default'),
    getAccountModelPreferenceKey('claude', 'host', 'work'),
    getAccountModelPreferenceKey('codex', 'host', 'default'),
    getAccountModelPreferenceKey('claude', 'ssh:server', 'default')
  ]
  assert.equal(new Set(keys).size, 4)
  let persisted = null
  const storage = {
    getItem: () => persisted,
    setItem: (_key, value) => {
      persisted = value
    }
  }
  const preferences = Object.fromEntries(keys.map((key, i) => [key, `model-${i}`]))
  writeAccountModelPreferences(preferences, storage)
  const restored = readAccountModelPreferences(storage)
  assert.deepEqual(restored, preferences)
  assert.equal(
    reconcileModelSelection(
      [{ id: 'model-0' }],
      {
        model: 'model-1',
        manuallySelected: true
      },
      ready,
      restored[keys[0]]
    ).model,
    'model-0'
  )
  persisted = JSON.stringify({ valid: 'A', empty: '', invalid: { model: 'B' } })
  assert.deepEqual(readAccountModelPreferences(storage), { valid: 'A' })
})

test('a failed catalog cannot replace a saved reasoning choice', () => {
  const selection = { reasoningEffort: 'max', manuallySelected: true }
  assert.deepEqual(
    reconcileReasoningSelection(auto, selection, {
      ...ready,
      error: 'Discovery failed'
    }),
    selection
  )
  assert.deepEqual(reconcileReasoningSelection(opus, selection, ready), selection)
})

test('a forced model applies where supported without replacing another provider selection', () => {
  assert.equal(resolveEffectiveModel([auto, opus], 'opus', 'gpt'), 'opus')
  assert.equal(resolveEffectiveModel([{ id: 'gpt' }], 'other-gpt', 'gpt'), 'gpt')
  assert.equal(resolveEffectiveModel([auto, opus], 'default', 'opus'), 'opus')
  assert.equal(resolveEffectiveModel([], 'opus', null), 'opus')
})
