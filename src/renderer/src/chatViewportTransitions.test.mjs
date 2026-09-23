import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

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


const nativeScrollCode = extract(
  './workspace/useConversationViewModel.tsx',
  'handleNativeChatContentScroll'
)

const setupScroll = ({ top = 0, bottom = 0, automatic = true, userIntent = false } = {}) => {
  const element = { scrollTop: top }
  const pages = []
  const context = vm.createContext({
    contentRef: { current: element },
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
