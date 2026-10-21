import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import {
  selectChatPreferences,
  updateChatPreferences,
  selectionsEqual
} from './chatModelPreferences.ts'

const source = ts.createSourceFile(
  'controller.tsx',
  readFileSync(new URL('./useWorkspaceController.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let effect
const find = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === 'useLayoutEffect' &&
    node.arguments[0]?.getText(source).includes('const currentSelection: MessageBoxSelection')
  )
    effect = node.arguments[0]
  ts.forEachChild(node, find)
}
find(source)
assert.ok(effect)
const code = ts.transpileModule(`(${effect.getText(source)})()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
const original = {
  agentMode: 'interactive',
  approvalMode: 'ask-user',
  sandboxMode: 'workspace-write',
  model: 'fixture',
  reasoningEffort: 'medium',
  serviceTier: null
}
const fixture = (selection = {}, overrides = {}) => {
  const calls = []
  const context = {
    console,
    ...original,
    ...selection,
    configProviderId: 'opencode',
    messageBoxChatKey: 'opencode:chat',
    messageBoxSelectionProviderRef: { current: 'opencode' },
    messageBoxSelectionChatKeyRef: { current: 'opencode:chat' },
    lastMessageBoxSelectionRef: { current: original },
    messageBoxSelectionsRef: { current: { opencode: original } },
    chatMessageBoxSelectionsRef: { current: {} },
    selectedChat: { id: 'chat', providerId: 'opencode', status: 'active', cwd: '/project' },
    chatDetailRef: { current: { status: 'active' } },
    chatsRef: { current: [] },
    projectRecordsByCwd: new Map([
      ['/project', { cwd: '/project', additionalCwds: ['/reference'] }]
    ]),
    effectiveAppSettings: {
      chat: {
        forceAccess: 'manual',
        forceReview: 'manual',
        updateExistingChats: false,
        updateNewChats: false
      }
    },
    appChatManualDropdownValue: 'manual',
    selectionsEqual,
    selectChatPreferences,
    updateChatPreferences,
    getApprovalAccessOptions: (review, access) => ({
      approvalPolicy:
        review === 'never' || access === 'danger-full-access' ? 'never' : 'on-request',
      approvalsReviewer: 'user'
    }),
    isActiveChatStatus: (status) =>
      ['active', 'waitingOnApproval', 'waitingOnUserInput'].includes(status),
    providerApi: {
      updateChatPermissions: async (...args) => {
        calls.push(args)
      }
    },
    writeStoredChatMessageBoxSelections() {},
    writeStoredMessageBoxSelections() {},
    getFallbackModels: () => [{ id: 'fixture' }],
    getDefaultModel: (models) => models[0],
    getDefaultReasoningEffort: () => 'medium',
    fallbackDefaultApprovalMode: 'ask-user',
    fallbackDefaultSandboxMode: 'workspace-write',
    modelManuallySelectedRef: {},
    reasoningManuallySelectedRef: {},
    approvalModeManuallySelectedRef: {},
    sandboxModeManuallySelectedRef: {},
    approvalModeBeforeFullAccessRef: {},
    setAgentMode() {},
    setApprovalMode() {},
    setSandboxMode() {},
    setModel() {},
    setReasoningEffort() {},
    setServiceTier() {},
    ...overrides
  }
  return { calls, context, run: () => vm.runInNewContext(code, context) }
}

test('choosing Allow all or Full access updates the running chat immediately', () => {
  for (const selection of [{ approvalMode: 'never' }, { sandboxMode: 'danger-full-access' }]) {
    const f = fixture(selection)
    f.run()
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.calls[0].slice(0, 2), ['opencode', 'chat'])
    assert.equal(f.calls[0][2].approvalPolicy, 'never')
    assert.deepEqual(Array.from(f.calls[0][2].additionalDirectories), ['/project', '/reference'])
  }
})

test('navigation does not apply the previous chat permission choice to the newly selected chat', () => {
  const f = fixture(
    { approvalMode: 'never' },
    { messageBoxSelectionChatKeyRef: { current: 'opencode:previous' } }
  )
  f.run()
  assert.equal(f.calls.length, 0)
})

test('model changes and idle chat selections do not update running permissions', () => {
  const model = fixture({ model: 'different' })
  model.run()
  assert.equal(model.calls.length, 0)
  const idle = fixture(
    { approvalMode: 'never' },
    { chatDetailRef: { current: { status: null } }, selectedChat: { id: 'chat', status: null } }
  )
  idle.run()
  assert.equal(idle.calls.length, 0)
})
