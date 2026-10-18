import { useCallback, useLayoutEffect, useMemo, useRef, type ReactElement } from 'react'
import { getProviderChatTurns } from '../../../../shared/chatTurns'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ArrowLeft, ChevronDown, CircleAlert } from 'lucide-react'
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
  const deferHistory =
    !initialWindow.current ||
    initialWindow.current.key !== mountKey ||
    (!initialWindow.current.changed && initialWindow.current.signature === windowSignature)
  useLayoutEffect(() => {
    if (!displayedTurns.length) {
      initialWindow.current = null
    } else if (initialWindow.current?.key !== mountKey) {
      initialWindow.current = { key: mountKey, signature: windowSignature, changed: false }
    } else if (initialWindow.current.signature !== windowSignature) {
      // Paging and new live turns must retain the existing immediate scroll-anchor
      // behavior. Only the first loaded window is mounted progressively.
      initialWindow.current.changed = true
    }
  }, [mountKey, windowSignature, displayedTurns.length])

  if (!selectedChat) return null

  const conversationHasActiveTurn = activeSubagentChatView
    ? activeSubagentChatView.detail?.status === 'pending' ||
      activeSubagentChatView.detail?.status === 'running'
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
          id="chat-search-content"
          aria-busy={
            activeSubagentChatView
              ? activeSubagentChatView.loadState === 'loading' || activeSubagentChatView.pageLoading
              : chatLoadState === 'loading' || Boolean(chatTurnPageLoadDirection)
          }
          key={
            activeSubagentChatView
              ? `${selectedChatKey}:subagent:${activeSubagentChatView.summary.id}`
              : selectedChatKey
          }
          onScroll={activeSubagentChatView ? undefined : handleNativeChatContentScroll}
          onWheel={activeSubagentChatView ? undefined : handleNativeChatContentWheel}
          ref={(element) => {
            if (activeSubagentChatView) {
              subagentContentRef.current = element
              if (element) contentRef.current = null
            } else {
              contentRef.current = element
              if (element) subagentContentRef.current = null
            }
            chatSearchContentRef.current = element
          }}
        >
          <div className="chat-detail__messages-layout">
            <div className="chat-detail__messages-header" />
            <div className="chat-detail__messages-inner">
              {activeSubagentChatView?.detail &&
                (activeSubagentChatView.detail.itemsStartTurnIndex ?? 0) > 0 && (
                  <Button
                    aria-label="Load older subagent messages"
                    title="Load older messages"
                    theme="secondary"
                    label="Load older messages"
                    disabled={activeSubagentChatView.pageLoading}
                    callback={() => void handleNavigateSubagentTurns('older')}
                  />
                )}
              {/* Transient activity belongs after history but before queued/steering turns. */}
              {renderedConversation}
              {activeSubagentChatView?.detail &&
                (activeSubagentChatView.detail.itemsStartTurnIndex ?? 0) + displayedTurns.length <
                  (activeSubagentChatView.detail.turnCount ?? displayedTurns.length) && (
                  <div>
                    <Button
                      aria-label="Load newer subagent messages"
                      title="Load newer messages"
                      theme="secondary"
                      label="Load newer messages"
                      disabled={activeSubagentChatView.pageLoading}
                      callback={() => void handleNavigateSubagentTurns('newer')}
                    />
                    <Button
                      aria-label="Jump to latest subagent messages"
                      title="Jump to latest messages"
                      theme="secondary"
                      label="Jump to latest"
                      disabled={activeSubagentChatView.pageLoading}
                      callback={() => void handleNavigateSubagentTurns('latest')}
                    />
                  </div>
                )}
            </div>
            <div className="chat-detail__messages-footer" />
          </div>
        </div>
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
        {activeSubagentChatView?.loadState === 'ready' && subagentVisibleChatItems.length === 0 && (
          <p className="chat__status chat-detail__messages-status">
            No messages found in this subagent chat.
          </p>
        )}
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
