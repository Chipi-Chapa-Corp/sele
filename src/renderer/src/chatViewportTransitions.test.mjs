import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { retainLoadedChatDetailTurnWindow } from './chatDetailWindow.ts'

const extract = (path, name) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let expression
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression)
  return ts.transpile(`globalThis.callback = ${expression}`, { target: ts.ScriptTarget.ES2022 })
}
const scrollCode = extract(
  './workspace/useChatInteractionController.tsx',
  'handleChatContentScroll'
)

test('automatic bottom correction cannot trigger paging into older history', () => {
  const element = { scrollTop: 0 }
  const context = vm.createContext({
    contentRef: { current: element },
    chatTurnWindowRef: { current: { chatKey: 'chat', startIndex: 0, endIndex: 2, totalCount: 2 } },
    chatScrollAdjustmentTargetRef: { current: null },
    previousChatScrollTopRef: { current: 1200 },
    chatTurnScrollDirectionRef: { current: null },
    chatAutoScrollTargetRef: { current: { element, top: 0 } },
    chatUserScrollIntentRef: { current: false },
    chatAutoScrollEnabledRef: { current: true },
    chatViewportAnchorRef: { current: null },
    setChatAtConversationBottom: () => {},
    isScrolledToBottom: () => true,
    readChatScrollAnchor: () => null
  })
  vm.runInContext(scrollCode, context)
  assert.equal(context.callback(), false, 'programmatic scroll must not enter history paging')
  assert.equal(context.chatTurnScrollDirectionRef.current, null)
  context.chatUserScrollIntentRef.current = true
  context.previousChatScrollTopRef.current = 100
  assert.equal(context.callback(), true, 'explicit user scrolling still enables paging')
  assert.equal(context.chatTurnScrollDirectionRef.current, 'up')
})

test('a shorter cursor tail preserves every message despite the previous viewport coordinates', () => {
  const snapshot = {
    id: 'chat',
    itemsStartTurnIndex: 0,
    turnCount: 2,
    turnPagination: { kind: 'cursor', olderCursor: 'older', newerCursor: null },
    items: [
      { type: 'message', id: 'previous', role: 'user', content: 'Previous' },
      { type: 'message', id: 'submitted', role: 'user', content: 'New message' },
      { type: 'working', id: 'working', status: 'working', items: [] }
    ]
  }
  const retained = retainLoadedChatDetailTurnWindow(snapshot, {
    startIndex: 10,
    endIndex: 20,
    totalCount: 20
  })
  assert.equal(retained, snapshot)
})

const sendCode = extract('./workspace/useChatMessagingController.tsx', 'handleSendMessage')
test('send immediately preserves history and appends the optimistic message at the existing revision', async () => {
  const detail = { id: 'chat', revision: 7, items: [{ id: 'history' }], capabilities: {} }
  let applied
  const context = vm.createContext({
    editingMessage: null,
    providerUpdateInProgress: false,
    sendInFlightRef: { current: false },
    activeSubagentChatView: null,
    selectedChat: { id: 'chat', providerId: 'codex' },
    changesProjectCwd: '/tmp',
    getChatCwdGroupKey: (x) => x,
    sendInFlightProjectKeyRef: { current: null },
    setSendInFlightProjectKey: () => {},
    chatAutoScrollEnabledRef: { current: false },
    setChatAtConversationBottom: () => {},
    scrollToLatestTurnAfterRenderRef: { current: false },
    serializeComposerMessage: (x) => x,
    normalizeTurnOptionsForModels: (x) => x,
    getCurrentTurnOptions: () => ({}),
    chatHasActiveTurn: false,
    chatDetail: detail,
    setSendState: () => {},
    getOptimisticItems: (items) => [
      ...items,
      { id: 'optimistic:user' },
      { id: 'optimistic:working' }
    ],
    applyViewedChatDetail: (_provider, next, options) => {
      if (next.revision <= detail.revision && !options?.allowEqualRevision) return
      applied = next
    },
    providerApi: { continueChatSummary: async () => ({}) },
    applyChatSummary: () => {},
    markChatSeenAt: () => {},
    console,
    handleSendFailure: (error) => {
      throw error
    }
  })
  vm.runInContext(sendCode, context)
  await context.callback('New message')
  assert.ok(applied, 'optimistic update must not be rejected as a stale provider snapshot')
  assert.equal(applied.items[0], detail.items[0])
  assert.equal(applied.items.at(-2).id, 'optimistic:user')
  assert.equal(context.scrollToLatestTurnAfterRenderRef.current, true)
})
