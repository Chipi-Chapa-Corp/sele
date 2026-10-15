import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {
  selectChatPreferences,
  updateChatPreferences,
  selectionsEqual
} from './chatModelPreferences.ts'

const first = {
  agentMode: 'interactive',
  approvalMode: 'ask-user',
  sandboxMode: 'workspace-write',
  model: 'model-a',
  reasoningEffort: 'high',
  serviceTier: null
}
const second = { ...first, model: 'model-b', reasoningEffort: 'low', serviceTier: 'priority' }

test('running chats retain their selections when existing-chat updates are disabled', () => {
  let chats = updateChatPreferences({}, 'codex:first', first, [])
  const defaults = { codex: second }
  // Changing the new-chat draft must leave the first running chat alone.
  chats = updateChatPreferences(chats, null, second, [])
  chats = updateChatPreferences(chats, 'codex:second', second, [])
  assert.deepEqual(selectChatPreferences(chats, defaults, 'codex', 'codex:first'), first)
  assert.deepEqual(selectChatPreferences(chats, defaults, 'codex', 'codex:second'), second)
  assert.deepEqual(selectChatPreferences(chats, defaults, 'codex', null), second)
  const reopened = JSON.parse(JSON.stringify(chats))
  assert.deepEqual(selectChatPreferences(reopened, defaults, 'codex', 'codex:first'), first)
})

test('existing-chat propagation changes only the targeted provider chats', () => {
  const chats = { 'codex:first': first, 'claude:first': first }
  const next = updateChatPreferences(chats, null, second, ['codex:first', 'codex:second'])
  assert.deepEqual(next['codex:first'], second)
  assert.deepEqual(next['codex:second'], second)
  assert.deepEqual(next['claude:first'], first)
  assert.deepEqual(chats['codex:first'], first)
})

test('saved creation snapshot takes precedence over a draft changed during startup', () => {
  const chats = { 'codex:first': first }
  assert.deepEqual(
    selectChatPreferences(chats, { codex: second }, 'codex', 'codex:first', second),
    first
  )
})

test('provider defaults and draft inheritance apply only without saved chat preferences', () => {
  assert.deepEqual(selectChatPreferences({}, { codex: second }, 'codex', 'codex:new', first), first)
  assert.deepEqual(selectChatPreferences({}, { claude: second }, 'claude', 'claude:new'), second)
  assert.deepEqual(selectChatPreferences({}, { codex: first }, 'claude', null), {})
})

test('restoring a selection is not a dropdown change to propagate', () => {
  assert.equal(selectionsEqual(first, { ...first }), true)
  assert.equal(selectionsEqual(first, second), false)
  assert.equal(selectionsEqual(null, first), false)
  assert.equal(selectionsEqual(first, { ...first, serviceTier: 'priority' }), false)
})

const controller = ts.createSourceFile(
  'controller.tsx',
  readFileSync(new URL('./useWorkspaceController.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let restoreEffect
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(controller) === 'useLayoutEffect' &&
    node.arguments[0]?.getText(controller).includes('const currentSelection: MessageBoxSelection')
  ) {
    restoreEffect = ts.transpile(`globalThis.restore = ${node.arguments[0].getText(controller)}`, {
      target: ts.ScriptTarget.ES2022
    })
  }
  ts.forEachChild(node, visit)
}
visit(controller)
assert.ok(restoreEffect)

test('navigation restores immediately, skips unchanged storage and batches outgoing/incoming changes', () => {
  const writes = []
  const ref = (current) => ({ current })
  const context = vm.createContext({
    ...first,
    configProviderId: 'codex',
    messageBoxChatKey: 'codex:second',
    messageBoxSelectionProviderRef: ref('codex'),
    messageBoxSelectionChatKeyRef: ref('codex:first'),
    messageBoxSelectionsRef: ref({ codex: first }),
    chatMessageBoxSelectionsRef: ref({ 'codex:first': first, 'codex:second': second }),
    lastMessageBoxSelectionRef: ref(first),
    modelManuallySelectedRef: ref(false),
    reasoningManuallySelectedRef: ref(false),
    approvalModeManuallySelectedRef: ref(false),
    sandboxModeManuallySelectedRef: ref(false),
    approvalModeBeforeFullAccessRef: ref(null),
    fallbackDefaultApprovalMode: 'ask-user',
    fallbackDefaultSandboxMode: 'workspace-write',
    getFallbackModels: () => [{ id: 'fallback' }],
    getDefaultModel: (models) => models[0],
    getDefaultReasoningEffort: () => 'medium',
    selectChatPreferences,
    selectionsEqual,
    writeStoredChatMessageBoxSelections: (value) => writes.push(JSON.parse(JSON.stringify(value))),
    writeStoredMessageBoxSelections: () =>
      assert.fail('restoring a chat must not update provider defaults')
  })
  for (const [setter, field] of Object.entries({
    setAgentMode: 'agentMode',
    setApprovalMode: 'approvalMode',
    setSandboxMode: 'sandboxMode',
    setModel: 'model',
    setReasoningEffort: 'reasoningEffort',
    setServiceTier: 'serviceTier'
  })) {
    context[setter] = (value) => {
      context[field] = value
    }
  }
  vm.runInContext(restoreEffect, context)
  context.restore()
  assert.equal(context.model, second.model)
  assert.equal(context.reasoningEffort, second.reasoningEffort)
  assert.equal(context.serviceTier, second.serviceTier)
  assert.equal(writes.length, 0, 'switching between saved selections requires no storage write')
  context.model = 'edited-before-switch'
  context.messageBoxChatKey = 'codex:new'
  context.restore()
  assert.equal(writes.length, 1)
  assert.equal(writes[0]['codex:second'].model, 'edited-before-switch')
  assert.deepEqual(writes[0]['codex:new'], first)
  assert.equal(context.model, first.model)
  context.messageBoxChatKey = 'codex:second'
  context.restore()
  assert.equal(context.model, 'edited-before-switch')
  assert.equal(writes.length, 1)
})
