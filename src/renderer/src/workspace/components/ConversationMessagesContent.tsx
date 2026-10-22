import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import {
  isNearChatPageBoundary,
  readChatScrollAnchor,
  restoreChatScrollAnchor
} from '../../chatLayout'
import { getProviderChatTurns } from '../../../../shared/chatTurns'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ArrowLeft, ChevronDown, CircleAlert, LoaderCircle } from 'lucide-react'
import { Button } from '../../components/Button'
import { ChatWorkingPlaceholder } from '../../components/ChatDetailItem'
import { getConversationTailWorkingStep } from '../../chatConversationModel'
import { ChatMediaGallery } from '../../components/ChatMediaGallery'
import { DeferredChatTurn } from '../../components/DeferredChatTurn'

type ConversationMessagesContentProps = WorkspaceController['conversationMessages']

const ConversationMessagesError: React.FC<{
  label: string
  title?: string
}> = ({ label, title }) => (
  <div className="chat-detail__messages-status" role="alert" title={title}>
    <CircleAlert className="chat-detail__messages-status-icon" aria-hidden="true" />
    <span>{label}</span>
  </div>
)

// Fast openings finish before this delay, so they never flash a loader.
const MESSAGES_LOADER_DELAY_MS = 1000

const DelayedMessagesLoader: React.FC = () => {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), MESSAGES_LOADER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])
  if (!visible) return null
  return (
    <div className="chat-detail__messages-status" role="status" aria-label="Loading messages">
      <LoaderCircle
        className="chat-detail__messages-status-icon chat-detail__messages-status-icon--loading"
        aria-hidden="true"
      />
      <span>Loading messages…</span>
    </div>
  )
}

export function ConversationMessagesContent(
  props: ConversationMessagesContentProps
): ReactElement | null {
  const {
    activeSubagentChatView,
    chatHasActiveTurn,
    chatAutoScrollEnabledRef,
    changesContainer,
    changesCwd,
    chatMediaStartIndex,
    chatMediaTotalCount,
    chatLoadState,
    chatHistoryPreview,
    chatKnown,
    chatSearchContentRef,
    chatTurnPageLoadDirection,
    commitChatReturnTarget,
    contentRef,
    editingMessage,
    effectiveChatTurnWindow,
    handleNativeChatContentScroll,
    handleNativeChatContentWheel,
    handleReturnFromAiCommitChat,
    handleReturnFromSubagentChat,
    handleNavigateSubagentTurns,
    loadChatTurnPage,
    renderChatTurn,
    renderSubagentChatTurn,
    renderedChatTurns,
    selectedChat,
    selectedChatCommitMarkers,
    selectedChatKey,
    selectedChatSubagents,
    scrollChatContentToBottom,
    sendState,
    showChatTurnDownButton,
    subagentChatConversationModel,
    subagentContentRef,
    subagentVisibleChatItems,
    visibleChatItems
  } = props

  const attachedContent = useRef<HTMLDivElement | null>(null)
  const showingSubagent = Boolean(activeSubagentChatView)
  const attachContent = useCallback(
    (element: HTMLDivElement | null) => {
      const previous = attachedContent.current
      if (previous && previous !== element) previous.removeAttribute('id')
      if (!element) {
        // A hidden Activity releases its refs. It must not clear another chat's
        // newly attached viewport, and only the visible viewport owns this ID.
        if (contentRef.current === previous) contentRef.current = null
        if (subagentContentRef.current === previous) subagentContentRef.current = null
        if (chatSearchContentRef.current === previous) chatSearchContentRef.current = null
      } else {
        element.id = 'chat-search-content'
        if (showingSubagent) {
          subagentContentRef.current = element
          contentRef.current = null
        } else {
          contentRef.current = element
          subagentContentRef.current = null
        }
        chatSearchContentRef.current = element
      }
      attachedContent.current = element
    },
    [contentRef, subagentContentRef, chatSearchContentRef, showingSubagent]
  )
  const subagentScroll = useRef({ id: '', start: 0, top: 0 })
  const subagentWindowId = activeSubagentChatView?.summary.id ?? ''
  const subagentWindowStart = activeSubagentChatView?.detail?.itemsStartTurnIndex ?? 0
  const subagentWindowReady = Boolean(activeSubagentChatView?.detail)
  const subagentHasDeferredContent = subagentChatConversationModel.turns.some(
    (turn) =>
      turn.items.length > 12 ||
      turn.items.reduce(
        (total, item) => total + (item.type === 'message' ? item.content.length : 0),
        0
      ) > 12_000
  )
  useLayoutEffect(() => {
    const element = subagentContentRef.current
    const inner = element?.querySelector('.chat-detail__messages-inner')
    if (
      !subagentWindowId ||
      !subagentWindowReady ||
      !subagentHasDeferredContent ||
      !element ||
      !inner
    )
      return
    let followBottom = true
    let firstResize = true
    const anchorKey = `${selectedChatKey}:subagent:${subagentWindowId}`
    let anchor = readChatScrollAnchor(element, anchorKey)
    let adjustedTop: number | null = null
    const onScroll = () => {
      if (adjustedTop !== null && Math.abs(element.scrollTop - adjustedTop) < 1) {
        adjustedTop = null
        return
      }
      followBottom = element.scrollHeight - element.clientHeight - element.scrollTop < 2
      anchor = readChatScrollAnchor(element, anchorKey)
    }
    const observer = new ResizeObserver(() => {
      if (firstResize) {
        // Controller layout effects may restore a saved viewport after this child mounts.
        // Learn that position before following later asynchronous Markdown growth.
        firstResize = false
        followBottom = element.scrollHeight - element.clientHeight - element.scrollTop < 2
        anchor = readChatScrollAnchor(element, anchorKey)
        return
      }
      if (followBottom) scrollChatContentToBottom(element)
      else if (anchor) restoreChatScrollAnchor(element, anchor)
      adjustedTop = element.scrollTop
      // Resizing Markdown is programmatic positioning, not a request for another page.
      subagentScroll.current = {
        id: subagentWindowId,
        start: subagentWindowStart,
        top: element.scrollTop
      }
    })
    observer.observe(inner)
    element.addEventListener('scroll', onScroll)
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', onScroll)
    }
  }, [
    subagentWindowId,
    subagentWindowStart,
    subagentWindowReady,
    subagentHasDeferredContent,
    subagentContentRef,
    selectedChatKey,
    scrollChatContentToBottom
  ])
  const loadSubagentPageNearBoundary = (
    element: HTMLDivElement,
    direction: 'older' | 'newer'
  ): void => {
    const view = activeSubagentChatView
    if (!view?.detail || view.pageLoading) return
    const start = view.detail.itemsStartTurnIndex ?? 0
    const end = start + subagentChatConversationModel.turns.length
    const hasPage = direction === 'older' ? start > 0 : end < (view.detail.turnCount ?? end)
    if (hasPage && isNearChatPageBoundary(element, direction, 160)) {
      void handleNavigateSubagentTurns(direction)
    }
  }
  const handleSubagentScroll = (element: HTMLDivElement): void => {
    const view = activeSubagentChatView
    if (!view?.detail) return
    const previous = subagentScroll.current
    const start = view.detail.itemsStartTurnIndex ?? 0
    subagentScroll.current = { id: view.summary.id, start, top: element.scrollTop }
    // Opening a child or positioning a newly loaded page is not user navigation.
    if (
      view.pageLoading ||
      previous.id !== view.summary.id ||
      previous.start !== start ||
      previous.top === element.scrollTop
    )
      return
    loadSubagentPageNearBoundary(element, element.scrollTop < previous.top ? 'older' : 'newer')
  }
  const mediaItems = activeSubagentChatView ? subagentVisibleChatItems : visibleChatItems
  const handleTurnMount = useCallback(() => {
    const element = contentRef.current
    if (element && chatAutoScrollEnabledRef.current) scrollChatContentToBottom(element)
  }, [contentRef, chatAutoScrollEnabledRef, scrollChatContentToBottom])
  const chatMediaTurns = useMemo(() => getProviderChatTurns(mediaItems), [mediaItems])
  const mediaOptions = useMemo(
    () => ({
      container: changesContainer,
      cwd: changesCwd,
      relativeTo: 'cwd' as const
    }),
    [changesContainer, changesCwd]
  )

  const displayedTurns = activeSubagentChatView
    ? subagentChatConversationModel.turns
    : renderedChatTurns
  const mountKey = `${selectedChatKey}:${activeSubagentChatView?.summary.id ?? ''}`
  const windowSignature = displayedTurns.map((turn) => turn.id).join('\n')
  const initialWindow = useRef<{ key: string; signature: string; changed: boolean } | null>(null)
  const openedRoot = useRef<string | null>(null)
  const returningToRoot =
    !activeSubagentChatView &&
    openedRoot.current === selectedChatKey &&
    initialWindow.current?.key !== mountKey
  const deferHistory =
    !returningToRoot &&
    (!initialWindow.current ||
      initialWindow.current.key !== mountKey ||
      (!initialWindow.current.changed && initialWindow.current.signature === windowSignature))
  useLayoutEffect(() => {
    if (!activeSubagentChatView && displayedTurns.length) openedRoot.current = selectedChatKey
    if (!displayedTurns.length) {
      initialWindow.current = null
    } else if (initialWindow.current?.key !== mountKey) {
      initialWindow.current = {
        key: mountKey,
        signature: windowSignature,
        changed: returningToRoot
      }
    } else if (initialWindow.current.signature !== windowSignature) {
      // Paging and new live turns must retain the existing immediate scroll-anchor
      // behavior. Only the first loaded window is mounted progressively.
      initialWindow.current.changed = true
    }
  }, [
    mountKey,
    windowSignature,
    displayedTurns.length,
    activeSubagentChatView,
    selectedChatKey,
    returningToRoot
  ])

  if (!selectedChat) return null

  const conversationHasActiveTurn = activeSubagentChatView
    ? activeSubagentChatView.summary.status === 'pending' ||
      activeSubagentChatView.summary.status === 'running'
    : chatHasActiveTurn
  const workingPlaceholderStep = conversationHasActiveTurn
    ? getConversationTailWorkingStep(
        activeSubagentChatView ? subagentVisibleChatItems : visibleChatItems,
        true
      )
    : null
  const firstPendingTurnIndex = displayedTurns.findIndex((turn) =>
    turn.items.some((item) => item.type === 'pendingMessage')
  )
  const renderedConversation = displayedTurns.map((turn, index) => (
    <DeferredChatTurn
      key={`${selectedChatKey}:${activeSubagentChatView?.summary.id ?? ''}:${turn.id}`}
      priority={index}
      onMount={!activeSubagentChatView && deferHistory ? handleTurnMount : undefined}
      eager={
        !deferHistory ||
        Boolean(activeSubagentChatView) ||
        index === displayedTurns.length - 1 ||
        Boolean(chatTurnPageLoadDirection) ||
        Boolean(activeSubagentChatView?.pageLoading)
      }
    >
      {activeSubagentChatView
        ? renderSubagentChatTurn(
            (activeSubagentChatView.detail?.itemsStartTurnIndex ?? 0) + index,
            turn
          )
        : renderChatTurn((effectiveChatTurnWindow?.startIndex ?? 0) + index, turn)}
    </DeferredChatTurn>
  ))
  if (workingPlaceholderStep) {
    renderedConversation.splice(
      firstPendingTurnIndex < 0 ? renderedConversation.length : firstPendingTurnIndex,
      0,
      <ChatWorkingPlaceholder
        item={workingPlaceholderStep}
        key={`working-placeholder:${workingPlaceholderStep.id}`}
      />
    )
  }

  return (
    <ChatMediaGallery
      key={
        activeSubagentChatView
          ? `${selectedChatKey}:subagent:${activeSubagentChatView.summary.id}`
          : selectedChatKey
      }
      turns={chatMediaTurns}
      startIndex={chatMediaStartIndex}
      totalCount={Math.max(chatMediaTotalCount ?? 0, chatMediaStartIndex + chatMediaTurns.length)}
      localImageOptions={mediaOptions}
    >
      <div className="chat-detail__messages-shell">
        {activeSubagentChatView ? (
          <div className="chat-detail__commit-back-button">
            <Button
              aria-label="Back to parent chat"
              title="Back to parent chat"
              callback={handleReturnFromSubagentChat}
              icon={<ArrowLeft aria-hidden="true" />}
              theme="secondary"
            />
          </div>
        ) : (
          commitChatReturnTarget?.providerId === selectedChat.providerId &&
          commitChatReturnTarget.commitChatId === selectedChat.id && (
            <div className="chat-detail__commit-back-button chat-detail__commit-back-button--original">
              <Button
                aria-label="Back to original chat"
                title="Back to original chat"
                callback={handleReturnFromAiCommitChat}
                icon={<ArrowLeft aria-hidden="true" />}
                theme="secondary"
              />
            </div>
          )
        )}
        <div
          className="chat-detail__messages"
          aria-busy={
            activeSubagentChatView
              ? activeSubagentChatView.loadState === 'loading' || activeSubagentChatView.pageLoading
              : (!chatKnown && chatLoadState === 'loading') || Boolean(chatTurnPageLoadDirection)
          }
          key={
            activeSubagentChatView
              ? `${selectedChatKey}:subagent:${activeSubagentChatView.summary.id}`
              : selectedChatKey
          }
          onScroll={
            activeSubagentChatView
              ? (event) => handleSubagentScroll(event.currentTarget)
              : handleNativeChatContentScroll
          }
          onWheel={
            activeSubagentChatView
              ? (event) => {
                  if (event.deltaY !== 0)
                    loadSubagentPageNearBoundary(
                      event.currentTarget,
                      event.deltaY < 0 ? 'older' : 'newer'
                    )
                }
              : handleNativeChatContentWheel
          }
          // Child paging also reassigns the shared viewport during controller
          // layout effects. Reattach on its commits, as in the uncached view.
          ref={showingSubagent ? (element) => attachContent(element) : attachContent}
        >
          <div className="chat-detail__messages-layout">
            <div className="chat-detail__messages-header" />
            <div className="chat-detail__messages-inner">
              {/* Transient activity belongs after history but before queued/steering turns. */}
              {renderedConversation}
            </div>
            <div className="chat-detail__messages-footer" />
          </div>
        </div>
        {!activeSubagentChatView && chatHistoryPreview && chatLoadState === 'error' && (
          <div className="chat-detail__history-preview" role="status">
            <span>
              {chatLoadState === 'error'
                ? 'Unable to refresh. Showing saved messages.'
                : 'Refreshing messages…'}
            </span>
            {chatLoadState === 'error' && (
              <Button label="Retry" callback={() => loadChatTurnPage('latest')} theme="secondary" />
            )}
          </div>
        )}
        {(activeSubagentChatView
          ? activeSubagentChatView.loadState === 'loading' && subagentVisibleChatItems.length === 0
          : !chatKnown && chatLoadState === 'loading' && visibleChatItems.length === 0) && (
          <DelayedMessagesLoader
            key={
              activeSubagentChatView
                ? `${selectedChatKey}:subagent:${activeSubagentChatView.summary.id}`
                : selectedChatKey
            }
          />
        )}
        {!activeSubagentChatView && chatLoadState === 'error' && visibleChatItems.length === 0 && (
          <ConversationMessagesError label="Unable to load messages." />
        )}
        {!activeSubagentChatView &&
          !editingMessage &&
          chatLoadState === 'ready' &&
          sendState !== 'sending' &&
          !chatHasActiveTurn &&
          visibleChatItems.length === 0 &&
          selectedChatCommitMarkers.length === 0 &&
          selectedChatSubagents.length === 0 && (
            <p className="chat__status chat-detail__messages-status">No messages found.</p>
          )}
        {activeSubagentChatView?.loadState === 'error' && (
          <ConversationMessagesError
            label="Unable to load this subagent chat."
            title={activeSubagentChatView.error ?? undefined}
          />
        )}
        {activeSubagentChatView?.loadState === 'ready' && activeSubagentChatView.error && (
          <ConversationMessagesError label={activeSubagentChatView.error} />
        )}
        {activeSubagentChatView?.loadState === 'ready' &&
          subagentVisibleChatItems.length === 0 &&
          (conversationHasActiveTurn ? (
            <div
              className="chat-detail__messages-status"
              role="status"
              aria-label="Subagent working"
            >
              <LoaderCircle className="app-loading-spinner" aria-hidden="true" />
              <span>Working…</span>
            </div>
          ) : (
            <p className="chat__status chat-detail__messages-status">
              No messages found in this subagent chat.
            </p>
          ))}
        {showChatTurnDownButton && (
          <div className="chat-detail__down-button">
            <Button
              aria-label="Jump to latest messages"
              disabled={chatTurnPageLoadDirection === 'latest'}
              theme="secondary"
              title="Jump to latest messages"
              callback={() => loadChatTurnPage('latest')}
              icon={<ChevronDown aria-hidden="true" />}
            />
          </div>
        )}
      </div>
    </ChatMediaGallery>
  )
}
