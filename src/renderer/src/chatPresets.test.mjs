import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatPresetChanges, readChatPresets, saveChatPreset } from './chatPresets.ts'

const selection = {
  model: 'model-a',
  reasoningEffort: 'high',
  sandboxMode: 'workspace-write',
  approvalMode: 'ask-user',
  agentMode: 'interactive',
  serviceTier: null
}
const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('presets survive reloads, stay provider-specific, and deduplicate full selections', () => {
  const storage = memoryStorage()
  assert.deepEqual(readChatPresets('codex', storage), [])
  saveChatPreset('codex', selection, storage)
  assert.deepEqual(readChatPresets('codex', storage), [selection])
  assert.deepEqual(readChatPresets('claude', storage), [])
  assert.deepEqual(saveChatPreset('codex', { ...selection }, storage), [selection])
  const fast = { ...selection, serviceTier: 'priority' }
  assert.deepEqual(saveChatPreset('codex', fast, storage), [selection, fast])
  const access = { ...selection, sandboxMode: 'danger-full-access', approvalMode: 'never' }
  assert.deepEqual(saveChatPreset('codex', access, storage), [selection, fast, access])
})

test('invalid stored rows are ignored without losing valid presets', () => {
  const storage = memoryStorage()
  storage.setItem(
    'sele:chat-presets:v1:codex',
    JSON.stringify([
      null,
      [],
      {},
      { ...selection, serviceTier: 42 },
      { ...selection, approvalMode: 'typo' },
      selection
    ])
  )
  assert.deepEqual(readChatPresets('codex', storage), [selection])
  storage.setItem('sele:chat-presets:v1:codex', '{}')
  assert.deepEqual(readChatPresets('codex', storage), [])
})

test('applying a preset omits forced settings and unavailable questions controls', () => {
  assert.deepEqual(
    getChatPresetChanges(selection, {
      model: false,
      reasoningEffort: true,
      sandboxMode: false,
      approvalMode: false,
      agentMode: false,
      serviceTier: true
    }),
    { reasoningEffort: 'high', serviceTier: null }
  )
})

test('failed writes propagate so the UI cannot report a preset as saved', () => {
  assert.throws(
    () =>
      saveChatPreset('codex', selection, {
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage unavailable')
        }
      }),
    /Storage unavailable/
  )
})

// Exercise the production handler: independent field callbacks cannot restore review
// when switching away from full access because they close over the old access mode.
const ts = (await import('typescript')).default
const { readFileSync } = await import('node:fs')
const vm = await import('node:vm')
const source = ts.createSourceFile(
  'controller.tsx',
  readFileSync(new URL('./useWorkspaceController.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let applyPresetSource
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleChatPresetChange') {
    applyPresetSource = ts.transpile(`globalThis.apply = ${node.initializer.getText(source)}`, {
      target: ts.ScriptTarget.ES2022
    })
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(applyPresetSource)

const controllerFixture = (initial) => {
  const state = { ...initial }
  const context = {
    ...initial,
    effectiveSandboxMode: initial.sandboxMode,
    models: [{ id: 'model-a', defaultReasoningEffort: 'low' }],
    getDefaultReasoningEffort: (model) => model.defaultReasoningEffort,
    modelManuallySelectedRef: { current: false },
    reasoningManuallySelectedRef: { current: false },
    sandboxModeManuallySelectedRef: { current: false },
    approvalModeManuallySelectedRef: { current: false },
    approvalModeBeforeFullAccessRef: { current: 'ask-user' }
  }
  for (const [setter, key] of Object.entries({
    setModel: 'model',
    setReasoningEffort: 'reasoningEffort',
    setSandboxMode: 'sandboxMode',
    setApprovalMode: 'approvalMode',
    setAgentMode: 'agentMode',
    setServiceTier: 'serviceTier'
  }))
    context[setter] = (value) => {
      state[key] = value
    }
  vm.runInNewContext(applyPresetSource, context)
  return { apply: context.apply, state, context }
}

test('a complete preset restores review when leaving full access and keeps explicit reasoning', () => {
  const fixture = controllerFixture({
    ...selection,
    sandboxMode: 'danger-full-access',
    approvalMode: 'never'
  })
  fixture.apply(selection)
  assert.deepEqual(fixture.state, selection)
  assert.equal(fixture.context.reasoningManuallySelectedRef.current, true)
  assert.equal(fixture.context.approvalModeManuallySelectedRef.current, true)
  assert.equal(fixture.context.approvalModeBeforeFullAccessRef.current, null)
})

test('a preset entering full access suppresses review and applies speed in the same change', () => {
  const fixture = controllerFixture(selection)
  fixture.apply({ ...selection, sandboxMode: 'danger-full-access', serviceTier: 'priority' })
  assert.equal(fixture.state.approvalMode, 'never')
  assert.equal(fixture.state.sandboxMode, 'danger-full-access')
  assert.equal(fixture.state.serviceTier, 'priority')
  assert.equal(fixture.context.approvalModeBeforeFullAccessRef.current, 'ask-user')
})
