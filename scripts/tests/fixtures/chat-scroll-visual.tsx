import React, { useState, useRef, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useConversationViewModel } from '../../../src/renderer/src/workspace/useConversationViewModel'
import { ConversationMessagesContent } from '../../../src/renderer/src/workspace/components/ConversationMessagesContent'
import { ChatDetailItem } from '../../../src/renderer/src/components/ChatDetailItem'
import * as layout from '../../../src/renderer/src/chatLayout'
import {
  getChatDetailFromSnapshot,
  getChatKey
} from '../../../src/renderer/src/workspace/chatControllerUtils'
import { retainLoadedChatDetailTurnWindow } from '../../../src/renderer/src/chatDetailWindow'
import '../../../src/renderer/src/App.css'
import '../../../src/renderer/src/assets/main.css'
Object.assign(window, layout, { getChatKey })
const noop = () => {}
const ref = (current) => ({ current })
const turns = Array.from({ length: 100 }, (_, i) => [
  {
    type: 'message',
    id: `user-${i}`,
    role: 'user',
    content: `Turn ${i + 1} — Review section ${i + 1} of the migration plan.`,
    editTargetId: null
  },
  {
    type: 'message',
    id: `answer-${i}`,
    role: 'assistant',
    content: `### Section ${i + 1}: verification notes\n\nThis is response **${i + 1}**. Check the order of the messages while scrolling through the conversation.\n\n${Array.from({ length: 1 + (i % 4) }, (_, j) => `Paragraph ${j + 1} of response ${i + 1}. The migration keeps existing records available while the new index is built. Verify the row counts, read latency, and rollback behavior before proceeding.`).join('\n\n')}\n\nThe expected next response is **${i + 2}**.`,
    editTargetId: null
  }
])
let provider = 'claude'
function detail(start = 90, end = 100) {
  return {
    id: 'chat',
    revision: 1,
    status: 'idle',
    items: turns.slice(start, end).flat(),
    itemsStartTurnIndex: provider === 'codex' ? 0 : start,
    turnCount: provider === 'codex' ? end - start : 100,
    capabilities: { editMessages: false },
    ...(provider === 'codex'
      ? {
          turnPagination: {
            kind: 'cursor',
            olderCursor: start ? String(start) : null,
            newerCursor: end < 100 ? String(end) : null
          }
        }
      : {})
  }
}
window.pageRequests = []
function page(start, limit) {
  window.pageRequests.push({ start, limit })
  return new Promise((resolve) => {
    window.pendingPage = () => {
      window.pendingPage = null
      const d = detail(start, start + limit)
      resolve({ ...d, startIndex: d.itemsStartTurnIndex, totalCount: d.turnCount })
    }
  })
}
window.providerApi.getChat = async () => detail()
window.providerApi.getChatTurnPage = (_p, _id, start, limit) => page(start, limit)
window.providerApi.getChatTurnCursorPage = (_p, _id, direction, cursor, limit) =>
  page(direction === 'older' ? Number(cursor) - limit : Number(cursor), limit)
function App({ kind }) {
  provider = kind
  const selectedChat = { id: 'chat', providerId: kind }
  const selectedChatKey = kind + ':chat'
  const [chatDetail, setDetail] = useState(() => detail())
  const [chatTurnWindow, setChatTurnWindow] = useState(null)
  const [chatAtConversationBottom, setChatAtConversationBottom] = useState(true)
  const [chatTurnPageLoadDirection, setChatTurnPageLoadDirection] = useState(null)
  const [recentChatReferencesCache, setRecentChatReferencesCache] = useState(null)
  const refs = useRef(null)
  if (!refs.current)
    refs.current = Object.fromEntries(
      Object.entries({
        contentRef: null,
        subagentContentRef: null,
        chatSearchContentRef: null,
        selectedChatRef: selectedChat,
        selectedChatKeyRef: selectedChatKey,
        chatDetailRef: chatDetail,
        chatTurnWindowRef: null,
        chatTurnPageLoadRequestRef: 0,
        chatTurnPageLoadInFlightRef: false,
        chatTurnScrollDirectionRef: null,
        chatAutoScrollEnabledRef: true,
        chatAutoScrollTargetRef: null,
        scrollToLatestTurnAfterRenderRef: false,
        pendingChatScrollAnchorRef: null,
        chatScrollAdjustmentTargetRef: null,
        chatViewportAnchorRef: null,
        pendingPinnedMessageNavigationRef: null,
        previousChatScrollTopRef: null,
        chatUserScrollIntentRef: false,
        chatUserScrollIntentFrameRef: null
      }).map(([key, value]) => [key, ref(value)])
    )
  const r = refs.current
  r.chatDetailRef.current = chatDetail
  const setChatDetail = (fn) =>
    setDetail((current) => {
      const next = typeof fn === 'function' ? fn(current) : fn
      r.chatDetailRef.current = next
      return next
    })
  const scrollChatContentToBottom = React.useCallback(
    (el) => {
      el.scrollTop = layout.getScrollBottomTop(el)
      r.chatAutoScrollTargetRef.current = { element: el, top: el.scrollTop }
    },
    [r.chatAutoScrollTargetRef]
  )
  const deps = {
    ...r,
    selectedChat,
    selectedChatKey,
    selectedChatId: 'chat',
    selectedProviderId: kind,
    chatDetail,
    chatTurnWindow,
    chatAtConversationBottom,
    chatTurnPageLoadDirection,
    recentChatReferencesCache,
    setChatDetail,
    setChatTurnWindow,
    setChatAtConversationBottom,
    setChatTurnPageLoadDirection,
    setRecentChatReferencesCache,
    scrollChatContentToBottom,
    scheduleChatAutoScroll: noop,
    scrollPinnedChatMessageIntoView: () => false,
    applyViewedChatDetail: (_p, d) => setChatDetail(d),
    newSessionProviderAvailable: true,
    providerUpdateInProgress: false,
    chatLoadState: 'ready',
    activeSubagentChatView: null,
    chatHasActiveTurn: false,
    sendState: 'idle',
    editingMessage: null,
    selectedChatSubagents: [],
    effectiveAppSettings: {
      performance: { recentsMessageLimit: 10, recentlyOpenedFilesLimit: 10 }
    },
    recentChatReferencePage: null,
    pinnedRecentChatReferences: {},
    recentlyOpenedFilesByWorkspace: {},
    recentlyOpenedFilesWorkspaceKey: 'test',
    changesPaneView: 'files',
    setRecentChatReferencePage: noop,
    continuedStoppedWorkingStepsByChat: {},
    selectedChatCommitMarkers: []
  }
  const handlers = window.makeInteraction(deps)
  const model = useConversationViewModel({ ...deps, ...handlers })
  window.useResize(deps)
  const renderChatTurn = (index, turn) => (
    <div
      className="chat-detail__turn"
      data-chat-turn-id={turn.id}
      data-chat-turn-index={index}
      key={turn.id}
    >
      {turn.items.map((item) => (
        <ChatDetailItem key={item.id} item={item} />
      ))}
    </div>
  )
  window.inspect = () => {
    const el = r.contentRef.current
    const rect = el.getBoundingClientRect()
    return {
      top: el.scrollTop,
      window: r.chatTurnWindowRef.current,
      pending: !!window.pendingPage,
      requests: window.pageRequests.length,
      visible: [...el.querySelectorAll('[data-chat-message-id]')]
        .map((e) => ({
          id: e.dataset.chatMessageId,
          top: e.getBoundingClientRect().top - rect.top,
          bottom: e.getBoundingClientRect().bottom - rect.top
        }))
        .filter((e) => e.bottom > 0 && e.top < rect.height)
    }
  }
  window.release = () => window.pendingPage?.()
  window.applyLive = () => {
    const next = getChatDetailFromSnapshot({ ...detail(), revision: 2 }, r.chatDetailRef.current, {
      preserveCurrentTurnWindow: !r.chatAutoScrollEnabledRef.current
    })
    setChatDetail(retainLoadedChatDetailTurnWindow(next, r.chatTurnWindowRef.current))
  }
  return (
    <main className="chat-panel" style={{ height: '100vh' }}>
      <header style={{ padding: '14px 24px', borderBottom: '1px solid #555' }}>
        {kind.toUpperCase()} · 100-turn scrolling verification
      </header>
      <ConversationMessagesContent
        {...deps}
        {...model}
        renderChatTurn={renderChatTurn}
        commitChatReturnTarget={null}
        showChatTurnDownButton={false}
      />
    </main>
  )
}
const root = createRoot(document.getElementById('root'))
window.openProvider = (kind) => {
  window.pageRequests = []
  window.pendingPage = null
  flushSync(() => root.render(<App key={kind + ':' + Date.now()} kind={kind} />))
}
window.startFrames = () => {
  window.frames = []
  window.recordFrames = true
  requestAnimationFrame(function frame(t) {
    if (!window.recordFrames) return
    window.frames.push({ t, ...window.inspect() })
    requestAnimationFrame(frame)
  })
}
window.prepareResize = () => {
  const message = document.querySelector('[data-chat-message-id="answer-95"]')
  const paragraphs = message.querySelectorAll('p')
  window.resizeAbove = paragraphs[1]
  window.resizeTarget = paragraphs[2]
}
window.targetOffset = () =>
  window.resizeTarget.getBoundingClientRect().top -
  document.querySelector('.chat-detail__messages').getBoundingClientRect().top
window.growContent = () => {
  window.resizeAbove.style.minHeight = '450px'
}
window.stopFrames = () => {
  window.recordFrames = false
  return window.frames
}
