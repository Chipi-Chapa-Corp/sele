import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

// Execute the actual effect and update callback with deferred provider responses.
const extract = (path, predicate) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let result
  const visit = (node) => {
    if (predicate(node, source))
      result = ts.isVariableDeclaration(node)
        ? node.initializer.getText(source)
        : node.arguments[0].getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, `Controller callback found in ${path}`)
  return ts.transpileModule(`globalThis.callback = ${result}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
}
const loadCode = extract(
  './workspace/useWorkspaceSelection.tsx',
  (node, source) =>
    ts.isCallExpression(node) &&
    node.expression.getText(source) === 'useEffect' &&
    node.arguments[0]?.getText(source).includes('Unable to load messages for')
)
const updateCode = extract(
  './useWorkspaceController.tsx',
  (node, source) =>
    ts.isCallExpression(node) &&
    node.expression.getText(source) === 'useCallback' &&
    ts.isVariableDeclaration(node.parent) &&
    node.parent.name.getText(source) === 'applyChatDetail'
)
const selectCode = extract(
  './useWorkspaceController.tsx',
  (node, source) =>
    ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSelectChat'
)

const setup = (providerId, initial = null) => {
  let resolve, reject
  const response = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  const state = { detail: initial, loadState: initial ? 'ready' : 'loading', errors: [] }
  const key = `${providerId}:chat`
  const context = vm.createContext({
    selectedProviderId: providerId,
    selectedChatId: 'chat',
    selectedChatKeyRef: { current: key },
    selectedChatUpdatedAtRef: { current: 1 },
    chatDetailRef: { current: initial },
    providerApi: { getChat: () => response },
    console: { error: (...args) => state.errors.push(args) },
    setChatDetail: (value) => {
      state.detail = typeof value === 'function' ? value(state.detail) : value
    },
    setChatLoadState: (value) => {
      state.loadState = value
    },
    startTransition: (fn) => fn(),
    isChatDetailSnapshotStale: (next, current) =>
      current?.id === next.id && next.revision <= current.revision,
    shouldPreserveOptimisticTurnUntilUserMessage: () => false,
    isActiveChatStatus: () => false,
    cacheRecentChatDetail: () => {},
    markChatSeenAt: () => {},
    resetChatSearch: () => {},
    getProviderChatKey: (provider, id) => `${provider}:${id}`,
    setSelectedChat: () => {},
    setChats: () => {},
    setNewChatOpen: () => {}
  })
  vm.runInContext(loadCode, context)
  const startLoad = context.callback
  vm.runInContext(updateCode, context)
  return {
    state,
    context,
    startLoad,
    update: (detail) => context.callback(providerId, detail),
    resolve,
    reject
  }
}
const detail = (revision = 1) => ({
  id: 'chat',
  revision,
  items: [{ type: 'message', content: 'Answer' }]
})
const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve))
}

for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
  test(`${provider}: failed history read preserves a live response`, async () => {
    const h = setup(provider)
    h.startLoad()
    const live = detail(2)
    h.update(live)
    h.reject(new Error('History read failed'))
    await settle()
    assert.equal(h.state.detail, live)
    assert.equal(h.context.chatDetailRef.current, live)
    assert.equal(h.state.loadState, 'ready')
    assert.equal(h.state.errors.length, 1)
  })
  test(`${provider}: live response recovers a failed initial load without reopening`, async () => {
    const h = setup(provider)
    h.startLoad()
    h.reject(new Error('History read failed'))
    await settle()
    assert.equal(h.state.loadState, 'error')
    assert.equal(h.state.detail, null)
    const live = detail(2)
    h.update(live)
    assert.equal(h.state.detail, live)
    assert.equal(h.state.loadState, 'ready')
  })
}
test('failed refresh preserves cached messages', async () => {
  const cached = detail()
  const h = setup('claude', cached)
  h.startLoad()
  h.reject(new Error('Refresh failed'))
  await settle()
  assert.equal(h.state.detail, cached)
  assert.equal(h.state.loadState, 'ready')
})
test('an update for another chat cannot clear the selected chat error', () => {
  const h = setup('claude')
  h.state.loadState = 'error'
  h.update({ ...detail(), id: 'other' })
  assert.equal(h.state.detail, null)
  assert.equal(h.state.loadState, 'error')
})
test('a duplicate update clears a stale overlay without replacing newer messages', () => {
  const current = detail(3)
  const h = setup('claude', current)
  h.state.loadState = 'error'
  h.update(detail(2))
  assert.equal(h.state.detail, current)
  assert.equal(h.state.loadState, 'ready')
})
test('a failed request from a closed chat is logged without changing the view', async () => {
  const h = setup('claude')
  const cleanup = h.startLoad()
  cleanup()
  h.reject(new Error('Old request failed'))
  await settle()
  assert.equal(h.state.loadState, 'loading')
  assert.equal(h.state.errors.length, 1)
  assert.match(h.state.errors[0][0], /Unable to load messages/)
})

test('cached selection stays loading until the deferred messages and ready state commit together', () => {
  const cached = detail()
  const state = { detail: null, loadState: 'ready' }
  const transitions = []
  const context = vm.createContext({
    selectedChat: null,
    chatLoadState: 'ready',
    chatDetail: null,
    getRecentCachedChatDetail: () => cached,
    getChatKey: (chat) => `${chat.providerId}:${chat.id}`,
    subagentChatLoadRequestRef: { current: 0 },
    sendInFlightRef: { current: false },
    recentlyViewedActiveChatPreviewsRef: { current: new Map() },
    selectedChatKeyRef: { current: null },
    selectedChatUpdatedAtRef: { current: null },
    chatDetailRef: { current: null },
    startTransition: (callback) => transitions.push(callback),
    setChatDetail: (value) => {
      state.detail = value
    },
    setChatLoadState: (value) => {
      state.loadState = value
    }
  })
  for (const name of [
    'resetChatSearch',
    'setCommitChatReturnTarget',
    'setSubagentChatView',
    'setSendState',
    'setEditingMessage',
    'setNewChatOpen',
    'setSearchOpen',
    'setSearchQuery',
    'markSelectedChatSeen',
    'setSelectedChat',
    'markChatSeenAt',
    'setChatLoadRequest'
  ])
    context[name] = () => {}
  vm.runInContext(selectCode, context)
  context.callback({ providerId: 'claude', id: 'chat', updatedAt: 1 })
  assert.equal(state.detail, null)
  assert.equal(state.loadState, 'loading')
  assert.equal(transitions.length, 1)
  transitions[0]()
  assert.equal(state.detail.id, 'chat')
  assert.equal(state.loadState, 'ready')
})

for (const outcome of ['stale response', 'failed refresh']) {
  test(`${outcome} cannot clear loading ahead of the pending cached render`, async () => {
    const cached = detail(3)
    const h = setup('claude', cached)
    h.state.detail = null
    h.state.loadState = 'loading'
    const transitions = [
      () => {
        h.context.setChatDetail(cached)
        h.context.setChatLoadState('ready')
      }
    ]
    h.context.startTransition = (callback) => transitions.push(callback)
    h.startLoad()
    if (outcome === 'stale response') h.resolve(detail(2))
    else h.reject(new Error('Fixture background refresh failure'))
    await settle()
    assert.equal(h.state.detail, null)
    assert.equal(h.state.loadState, 'loading')
    transitions.forEach((callback) => callback())
    assert.equal(h.state.detail, cached)
    assert.equal(h.state.loadState, 'ready')
  })
}

test('delayed metadata cannot make a viewed chat unread again', async () => {
  const { mergeChatMetadata } = await import('./chatMetadata.ts')
  const current = { id: 'parent', seenUpdatedAt: 500, updatedAt: 400 }
  assert.equal(mergeChatMetadata(current, { id: 'parent', seenUpdatedAt: 300 }).seenUpdatedAt, 500)
  assert.equal(mergeChatMetadata(current, { id: 'parent', seenUpdatedAt: null }).seenUpdatedAt, 500)
  assert.equal(mergeChatMetadata(current, { id: 'parent', seenUpdatedAt: 600 }).seenUpdatedAt, 600)
})
