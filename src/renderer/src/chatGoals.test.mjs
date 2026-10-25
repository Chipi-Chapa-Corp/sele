import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'controller.tsx',
  readFileSync(new URL('./workspace/useChatMessagingController.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const declarations = new Map()
const visit = (node) => {
  if (ts.isVariableDeclaration(node))
    declarations.set(node.name.getText(source), node.getText(source))
  ts.forEachChild(node, visit)
}
visit(source)
const controller = ts.transpile(
  ['handleSendMessage', 'handleStartGoalChat']
    .map((name) => `const ${declarations.get(name)}`)
    .join('\n'),
  { target: ts.ScriptTarget.ES2022 }
)

const setup = (overrides = {}) => {
  const calls = [],
    states = [],
    drafts = []
  const detail = { id: 'chat', items: [], goal: { objective: 'Checks pass', status: 'active' } }
  const globals = {
    configProviderId: 'codex',
    providerUpdateInProgress: false,
    authenticationRequired: false,
    chatDetailRef: { current: null },
    activeSubagentChatView: null,
    selectedChat: null,
    sendInFlightRef: { current: false },
    sendInFlightProjectKeyRef: { current: null },
    newSessionCwd: '/repo',
    newSessionNoProject: false,
    newSessionLocation: 'folder',
    newSessionProvider: 'codex',
    changesContainer: null,
    defaultCwd: null,
    chatAutoScrollEnabledRef: { current: false },
    scrollToLatestTurnAfterRenderRef: { current: false },
    worktreeCreationCanceledRef: { current: false },
    worktreeBranchGenerationRef: { current: null },
    setSendInFlightProjectKey() {},
    setSendState: (state) => states.push(state),
    setChatAtConversationBottom() {},
    setWorktreeCreationState() {},
    getChatCwdGroupKey: (cwd) => cwd,
    serializeComposerMessage: (message) => message,
    normalizeTurnOptionsForModels: (options) => options,
    getCurrentTurnOptions: () => ({
      model: 'chosen',
      sandboxMode: 'read-only',
      approvalPolicy: 'on-request'
    }),
    editingMessage: null,
    isNoProjectChat: () => false,
    isNoProjectCwd: () => false,
    noProjectGroupKey: 'general',
    getContainerTargetKey: () => 'host',
    getChatKey: (chat) => `${chat.providerId}:${chat.id}`,
    messageBoxSelection: { model: 'chosen' },
    rememberStartedChatSelection() {},
    updateStoredComposerDrafts: (update) => update({}),
    getComposerDraftScopeKey: (chat, workspace) => chat ?? workspace,
    moveComposerDraftScope: (_state, from, to) => drafts.push([from, to]),
    applyViewedChatDetail: (_provider, chat) => calls.push(['view', chat]),
    hasProviderUserMessage: () => false,
    getOptimisticItems: () =>
      assert.fail('must not invent an ordinary message for native goal commands'),
    selectedChatKeyRef: { current: 'codex:chat' },
    providerApi: {
      startChat: async (...args) => {
        calls.push(['start', ...args])
        return detail
      },
      setViewedChat() {},
      getChat: async () => detail
    },
    handleSendFailure: () => assert.fail('goal failures belong in the goal dialog'),
    console: { error() {} },
    ...overrides
  }
  const start = vm.runInNewContext(`${controller}; handleStartGoalChat`, globals)
  return { start, globals, calls, states, drafts }
}

test('starting from a goal creates and selects a chat with current settings and migrates its composer draft', async () => {
  const h = setup()
  await h.start('  Checks pass  ')
  const [, provider, message, options] = h.calls.find(([type]) => type === 'start')
  assert.equal(provider, 'codex')
  assert.equal(message, 'Checks pass')
  assert.equal(options.initialGoal, 'Checks pass')
  assert.equal(options.cwd, '/repo')
  assert.equal(options.model, 'chosen')
  assert.equal(options.sandboxMode, 'read-only')
  assert.equal(options.approvalPolicy, 'on-request')
  assert.equal(h.calls.find(([type]) => type === 'view')[1].goal.status, 'active')
  assert.equal(h.drafts[0][1], 'codex:chat')
  assert.equal(h.globals.sendInFlightRef.current, false)
  assert.equal(h.states.at(-1), 'idle')
})

test('No Project goals preserve workspace selection', async () => {
  const h = setup({ newSessionNoProject: true, newSessionCwd: null })
  await h.start('Checks pass')
  const options = h.calls.find(([type]) => type === 'start')[3]
  assert.equal(options.noProject, true)
  assert.equal(options.cwd, undefined)
})

test('goal startup failures surface the native error and release the send lock for retry', async () => {
  const h = setup()
  const startChat = h.globals.providerApi.startChat
  h.globals.providerApi.startChat = async () => {
    throw new Error('Native goal unavailable')
  }
  await assert.rejects(h.start('Checks pass'), /Native goal unavailable/)
  assert.equal(h.globals.sendInFlightRef.current, false)
  assert.equal(h.states.at(-1), 'idle')
  assert.equal(h.drafts.length, 0)
  h.globals.providerApi.startChat = startChat
  await h.start('Checks pass')
  assert.equal(h.calls.filter(([type]) => type === 'start').length, 1)
})

test('pending, unauthenticated, or empty goal submissions cannot create a second session', async () => {
  const h = setup()
  let finish
  const startChat = h.globals.providerApi.startChat
  h.globals.providerApi.startChat = (...args) =>
    new Promise((resolve) => {
      finish = async () => resolve(await startChat(...args))
    })
  const pending = h.start('Checks pass')
  await assert.rejects(h.start('Other goal'), /chat is ready/)
  await finish()
  await pending
  h.globals.authenticationRequired = true
  await assert.rejects(h.start('Other goal'), /chat is ready/)
  await assert.rejects(h.start('   '), /goal description/)
  assert.equal(h.calls.filter(([type]) => type === 'start').length, 1)
})

test('new goals use the normal worktree flow and cancellation never reports success', async () => {
  const h = setup({
    newSessionLocation: 'worktree',
    crypto: { randomUUID: () => 'generation' },
    getGitTurnOptions: () => ({}),
    effectiveAppSettings: { git: { worktree: {} } },
    getWorktreeBranchGenerationPrompt: (goal) => goal,
    normalizeGeneratedWorktreeName: (name) => name,
    appApi: { createGitWorktree: async () => ({ worktreePath: '/worktree' }) }
  })
  h.globals.providerApi.generateOneShot = async () => 'goal-branch'
  await h.start('Checks pass')
  assert.equal(h.calls.find(([type]) => type === 'start')[3].cwd, '/worktree')
  h.globals.providerApi.generateOneShot = async () => {
    h.globals.worktreeCreationCanceledRef.current = true
    return 'goal-branch'
  }
  await assert.rejects(h.start('Checks pass'), /canceled/)
  assert.equal(h.calls.filter(([type]) => type === 'start').length, 1)
  assert.equal(h.globals.sendInFlightRef.current, false)
})

test('the composer offers new-chat goals for supported providers and respects existing chat capabilities', () => {
  const workspace = ts.createSourceFile(
    'workspace.tsx',
    readFileSync(new URL('./useWorkspaceController.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let expression
  const find = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(workspace) === 'onSetGoal')
      expression = node.initializer.getText(workspace)
    ts.forEachChild(node, find)
  }
  find(workspace)
  const globals = {
    activeSubagentChatView: null,
    selectedChat: null,
    newChatOpen: true,
    newSessionProviderAvailable: true,
    handleSaveGoalObjective: () => {},
    newSessionProvider: 'codex'
  }
  const offered = () => Boolean(vm.runInNewContext(expression, globals))
  for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
    globals.newSessionProvider = provider
    assert.equal(offered(), provider !== 'opencode')
  }
  globals.selectedChat = { id: 'chat' }
  globals.chatDetail = { id: 'chat', capabilities: { setGoal: true } }
  assert.equal(offered(), true)
  globals.chatDetail.historyPreview = true
  assert.equal(offered(), false)
  globals.chatDetail.historyPreview = false
  globals.chatDetail.capabilities.setGoal = false
  assert.equal(offered(), false)
})
