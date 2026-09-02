import type { ReactElement } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'
import { ArrowLeft, ChevronDown, CircleAlert, LoaderCircle } from 'lucide-react'
import { Button } from '../../components/Button'

type ConversationMessagesContentProps = WorkspaceController['conversationMessages']

const ConversationMessagesState: React.FC<{
  kind: 'loading' | 'error'
  label: string
  title?: string
}> = ({ kind, label, title }) => (
  <div
    className="chat-detail__messages-status"
    role={kind === 'error' ? 'alert' : 'status'}
    title={title}
  >
    {kind === 'loading' ? (
      <LoaderCircle
        className="app-loading-spinner chat-detail__messages-status-icon chat-detail__messages-status-icon--loading"
        aria-hidden="true"
      />
    ) : (
      <CircleAlert className="chat-detail__messages-status-icon" aria-hidden="true" />
    )}
    <span>{label}</span>
  </div>
)

export function ConversationMessagesContent(
  props: ConversationMessagesContentProps
): ReactElement | null {
  const {
    activeSubagentChatView,
    chatHasActiveTurn,
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
    loadChatTurnPage,
    renderChatTurn,
    renderSubagentChatTurn,
    renderedChatTurns,
    selectedChat,
    selectedChatCommitMarkers,
    selectedChatKey,
    selectedChatSubagents,
    sendState,
    showChatTurnDownButton,
    subagentChatConversationModel,
    subagentContentRef,
    subagentVisibleChatItems,
    visibleChatItems
  } = props

  if (!selectedChat) return null

  return (
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
            {activeSubagentChatView
              ? subagentChatConversationModel.turns.map((turn, index) =>
                  renderSubagentChatTurn(index, turn)
                )
              : renderedChatTurns.map((turn, index) =>
                  renderChatTurn((effectiveChatTurnWindow?.startIndex ?? 0) + index, turn)
                )}
          </div>
          <div className="chat-detail__messages-footer" />
        </div>
      </div>
      {!activeSubagentChatView && chatLoadState === 'loading' && (
        <ConversationMessagesState kind="loading" label="Loading messages…" />
      )}
      {!activeSubagentChatView && chatLoadState === 'error' && (
        <ConversationMessagesState kind="error" label="Unable to load messages." />
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
      {activeSubagentChatView?.loadState === 'loading' && !activeSubagentChatView.detail && (
        <ConversationMessagesState kind="loading" label="Loading subagent chat…" />
      )}
      {activeSubagentChatView?.loadState === 'error' && (
        <ConversationMessagesState
          kind="error"
          label="Unable to load this subagent chat."
          title={activeSubagentChatView.error ?? undefined}
        />
      )}
      {activeSubagentChatView?.loadState === 'ready' && subagentVisibleChatItems.length === 0 && (
        <p className="chat__status chat-detail__messages-status">
          No messages found in this subagent chat.
        </p>
      )}
      {!activeSubagentChatView &&
        chatTurnPageLoadDirection &&
        chatTurnPageLoadDirection !== 'latest' && (
          <ConversationMessagesState kind="loading" label="Loading messages…" />
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
  )
}
