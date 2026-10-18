import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { alignChatContentToBottom } from './chatLayout.ts'

const extract = (path, name, effectMarker) => {
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
    if (
      effectMarker &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'useEffect' &&
      node.arguments[0]?.getText(source).includes(effectMarker)
    ) {
      expression = node.arguments[0].getText(source)
    }
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
    chatDetail: null,
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

const nativeScrollCode = extract(
  './workspace/useConversationViewModel.tsx',
  'handleNativeChatContentScroll'
)

const setupScroll = ({ top = 0, bottom = 0, automatic = true, userIntent = false } = {}) => {
  const element = { scrollTop: top }
  const pages = []
  const context = vm.createContext({
    contentRef: { current: element },
    chatDetail: null,
    chatTurnWindowRef: {
      current: { chatKey: 'claude:chat', startIndex: 10, endIndex: 20, totalCount: 20 }
    },
    chatScrollAdjustmentTargetRef: { current: null },
    previousChatScrollTopRef: { current: 1200 },
    chatTurnScrollDirectionRef: { current: null },
    chatAutoScrollTargetRef: { current: automatic ? { element, top } : null },
    chatUserScrollIntentRef: { current: userIntent },
    chatAutoScrollEnabledRef: { current: automatic },
    chatViewportAnchorRef: { current: null },
    chatTurnPageLoadInFlightRef: { current: false },
    chatTurnLoadThresholdPx: 100,
    setChatAtConversationBottom: () => {},
    isScrolledToBottom: () => bottom - element.scrollTop <= 1,
    getScrollBottomTop: () => bottom,
    readChatScrollAnchor: () => null,
    scheduleChatAutoScroll: () => {},
    loadChatTurnPage: (direction) => pages.push(direction)
  })
  vm.runInContext(scrollCode, context)
  context.handleChatContentScroll = context.callback
  vm.runInContext(nativeScrollCode, context)
  return { context, pages, element }
}

test('completion height collapse cannot replace the latest response with an older page', () => {
  const { context, pages } = setupScroll()
  context.callback()
  assert.deepEqual(pages, [])
  assert.equal(context.chatAutoScrollEnabledRef.current, true)
})

test('a streaming resize between bottom correction and scroll delivery cannot page history', () => {
  const { context, pages } = setupScroll({ top: 20, bottom: 200 })
  context.chatTurnScrollDirectionRef.current = 'up'
  context.callback()
  assert.deepEqual(pages, [])
  assert.equal(context.chatAutoScrollEnabledRef.current, true)
})

test('anchor restoration cannot trigger history paging', () => {
  const { context, pages, element } = setupScroll({ automatic: false, bottom: 200 })
  context.chatScrollAdjustmentTargetRef.current = { element, top: 0 }
  context.callback()
  assert.deepEqual(pages, [])
})

test('user scrolling upward still loads older turns', () => {
  const { context, pages } = setupScroll({ userIntent: true, bottom: 200 })
  context.callback()
  assert.deepEqual(pages, ['older'])
  assert.equal(context.chatAutoScrollEnabledRef.current, false)
})

test('user scrolling downward still loads newer turns', () => {
  const { context, pages } = setupScroll({ automatic: false, top: 200, bottom: 200 })
  context.previousChatScrollTopRef.current = 100
  context.chatTurnWindowRef.current.endIndex = 15
  context.callback()
  assert.deepEqual(pages, ['newer'])
})

test('the bottom of a historical cursor page does not enable following the live tail', () => {
  const { context } = setupScroll({ automatic: false, top: 200, bottom: 200 })
  context.chatDetail = { turnPagination: { kind: 'cursor', newerCursor: 'newer' } }
  context.callback()
  assert.equal(context.chatAutoScrollEnabledRef.current, false)
})

test('bottom following skips detailed measurements and captures anchors after user scrolling', () => {
  const { context } = setupScroll({ top: 200, bottom: 200 })
  let reads = 0
  context.readChatScrollAnchor = () => {
    reads++
    return { turnId: 'visible' }
  }
  context.chatViewportAnchorRef.current = { turnId: 'obsolete' }
  context.callback()
  assert.equal(reads, 0)
  assert.equal(context.chatViewportAnchorRef.current, null)
  context.contentRef.current.scrollTop = 100
  context.chatAutoScrollTargetRef.current = null
  context.chatUserScrollIntentRef.current = true
  context.callback()
  assert.equal(reads, 1)
  assert.equal(context.chatViewportAnchorRef.current.turnId, 'visible')
})

test('initial bottom positioning retains its offset without walking message descendants', () => {
  const code = extract('./useWorkspaceController.tsx', 'scrollChatContentToBottom')
  let scrollTop = 0
  const element = {
    get scrollTop() {
      return scrollTop
    },
    set scrollTop(top) {
      scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight))
    },
    scrollHeight: 4000,
    clientHeight: 300,
    querySelector: (selector) => {
      assert.equal(selector, '.chat-detail__messages-inner')
      return null
    }
  }
  const context = vm.createContext({
    useCallback: (fn) => fn,
    chatAtConversationBottomRef: { current: false },
    chatAutoScrollTargetRef: { current: null },
    chatViewportAnchorRef: { current: {} },
    selectedChatKeyRef: { current: 'codex:chat' },
    setChatAtConversationBottom: (value) => assert.equal(value, true),
    alignChatContentToBottom,
    readChatScrollAnchor: () => assert.fail('bottom positioning must not measure individual blocks')
  })
  vm.runInContext(code, context)
  context.callback(element)
  assert.equal(element.scrollTop, 3700)
  assert.equal(context.chatAutoScrollTargetRef.current.top, 3700)
  assert.equal(context.chatViewportAnchorRef.current, null)
})

test('an unmatched search still anchors the viewport when it stops bottom following', () => {
  const code = extract(
    './workspace/useWorkspaceSelection.tsx',
    null,
    'const refreshMatches = (resetActiveMatch: boolean)'
  )
  const element = {}
  const anchor = { turnId: 'visible-bottom-message' }
  const context = vm.createContext({
    chatSearchOpen: true,
    chatSearchQuery: 'missing',
    selectedChatKey: 'codex:chat',
    chatSearchContentRef: { current: element },
    contentRef: { current: element },
    chatSearchActiveIndexRef: { current: 0 },
    chatSearchMatchesRef: { current: [] },
    chatAutoScrollEnabledRef: { current: true },
    chatAutoScrollTargetRef: { current: {} },
    chatViewportAnchorRef: { current: null },
    findChatSearchMatches: () => [],
    setChatSearchMatchCount: (count) => assert.equal(count, 0),
    setChatSearchActiveIndex: () => {},
    setChatSearchHighlights: () => {},
    clearChatSearchHighlights: () => {},
    scrollChatSearchMatchIntoView: () => assert.fail('there is no matching message to scroll to'),
    readChatScrollAnchor: (content, key) => {
      assert.equal(content, element)
      assert.equal(key, 'codex:chat')
      return anchor
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    }
  })
  vm.runInContext(code, context)
  const cleanup = context.callback()
  assert.equal(context.chatAutoScrollEnabledRef.current, false)
  assert.equal(context.chatViewportAnchorRef.current, anchor)
  cleanup()
})
