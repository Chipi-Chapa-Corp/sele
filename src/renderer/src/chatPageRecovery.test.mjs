import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { extendChatCursorWindow } from './chatCursorWindow.ts'
import { getChatDetailTurnCount, replaceChatDetailWithCursorPage } from './chatDetailWindow.ts'

const source = ts.createSourceFile(
  'view.tsx',
  readFileSync(new URL('./workspace/useConversationViewModel.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let callback
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'loadChatTurnPage')
    callback = node.initializer.arguments[0].getText(source)
  ts.forEachChild(node, visit)
}
visit(source)
const code = ts.transpileModule(`globalThis.load=${callback}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText
const item = (id) => ({ id, type: 'message', role: 'user', content: id })
function fixture() {
  const detail = {
    id: 'chat',
    revision: 2,
    items: [item('anchor')],
    turnPagination: { kind: 'cursor', olderCursor: 'expired', newerCursor: null },
    turnCount: 1
  }
  const page = {
    items: [item('anchor')],
    startIndex: 0,
    totalCount: 1,
    turnPagination: { kind: 'cursor', olderCursor: 'fresh', newerCursor: null }
  }
  const calls = []
  const ref = (current) => ({ current })
  const context = vm.createContext({
    Date,
    console: { error() {} },
    selectedChatRef: ref({ providerId: 'opencode-v2', id: 'chat' }),
    selectedChatKeyRef: ref('key'),
    chatDetailRef: ref(detail),
    chatTurnWindowRef: ref({ chatKey: 'key', startIndex: 0, endIndex: 1, totalCount: 1 }),
    chatTurnPageLoadInFlightRef: ref(false),
    chatTurnPageLoadRequestRef: ref(0),
    failedPageReadRef: ref(null),
    cursorWindowRef: ref(null),
    contentRef: ref({}),
    chatAutoScrollEnabledRef: ref(false),
    chatAutoScrollTargetRef: ref(null),
    scrollToLatestTurnAfterRenderRef: ref(false),
    pendingChatScrollAnchorRef: ref(null),
    chatTurnPageSize: 10,
    chatTurnLoadThresholdPx: 160,
    getChatKey: () => 'key',
    getLoadedChatTurnWindow: (_d, w) => w,
    getChatDetailTurnCount,
    isNearChatPageBoundary: () => true,
    readChatScrollAnchor: () => ({ chatKey: 'key', turnId: 'anchor', offset: 20 }),
    extendChatCursorWindow,
    replaceChatDetailWithCursorPage,
    flushSync: (fn) => fn(),
    setChatTurnPageLoadDirection: (value) => calls.push(['loading', value]),
    setChatDetail: (value) => calls.push(['detail', value]),
    setChatTurnWindow() {},
    providerApi: {
      getChatTurnCursorPage: async () => {
        calls.push(['cursor'])
        throw Error('OpenCode history cursor expired. Reopen the conversation.')
      },
      getChatTurnPageForItem: async (...args) => {
        calls.push(['recover', ...args])
        return page
      }
    }
  })
  vm.runInContext(code, context)
  return { context, detail, page, calls, load: context.load }
}
test('an expired native cursor recovers around the visible item and preserves the viewport anchor', async () => {
  const f = fixture()
  await f.load('older')
  assert.equal(f.calls.filter((c) => c[0] === 'cursor').length, 1)
  assert.deepEqual(
    f.calls.find((c) => c[0] === 'recover'),
    ['recover', 'opencode-v2', 'chat', 'anchor', 10]
  )
  assert.equal(f.context.chatDetailRef.current.turnPagination.olderCursor, 'fresh')
  assert.equal(f.context.pendingChatScrollAnchorRef.current.turnId, 'anchor')
  assert.equal(f.context.chatAutoScrollEnabledRef.current, false)
  assert.equal(f.context.cursorWindowRef.current.pages.length, 1)
})
test('failed page reads cannot retry on every wheel or programmatic scroll event', async () => {
  const f = fixture()
  f.context.providerApi.getChatTurnPageForItem = async () => {
    throw Error('Fixture offline')
  }
  await f.load('older')
  await f.load('older')
  await f.load('older')
  assert.equal(f.calls.filter((c) => c[0] === 'cursor').length, 1)
  assert.equal(f.context.chatDetailRef.current, f.detail)
  f.detail.turnPagination.olderCursor = 'another-boundary'
  await f.load('older')
  assert.equal(
    f.calls.filter((c) => c[0] === 'cursor').length,
    2,
    'new boundaries remain independently readable'
  )
})
test('fresh page boundaries discard a retained buffer with stale native cursors', () => {
  const a = {
    items: [item('one')],
    startIndex: 0,
    totalCount: 1,
    turnPagination: { kind: 'cursor', olderCursor: 'old-older', newerCursor: 'middle' }
  }
  const b = {
    items: [item('two')],
    startIndex: 0,
    totalCount: 1,
    turnPagination: { kind: 'cursor', olderCursor: 'middle', newerCursor: null }
  }
  const detail = {
    id: 'chat',
    items: [...a.items, ...b.items],
    turnPagination: { kind: 'cursor', olderCursor: 'new-older', newerCursor: null }
  }
  const page = {
    items: [item('zero')],
    startIndex: 0,
    totalCount: 1,
    turnPagination: { kind: 'cursor', olderCursor: 'before', newerCursor: 'new-older' }
  }
  const next = extendChatCursorWindow(
    { chatKey: 'key', items: detail.items, pages: [a, b] },
    'key',
    detail,
    page,
    'older'
  )
  assert.equal(next.pages[1].turnPagination.olderCursor, 'new-older')
  assert.deepEqual(
    next.items.map((i) => i.id),
    ['zero', 'one', 'two']
  )
})
