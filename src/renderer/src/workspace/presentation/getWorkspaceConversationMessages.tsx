import { conversationViews } from '../../conversationViews'
import { useWorkspaceTurnRendering } from '../features/useWorkspaceTurnRendering'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function getWorkspaceConversationMessages({
  chatState,
  chatCache,
  viewportState,
  scroll,
  session,
  interactions,
  searchState,
  gitState,
  conversation,
  commits,
  subagents,
  turnRendering,
  subagentState
}: WorkspaceChanges & {
  turnRendering: ReturnType<typeof useWorkspaceTurnRendering>
}) {
  return {
    visible: Boolean(chatState.selectedChat),
    chatKnown: Boolean(chatState.selectedChat && conversationViews.has(chatState.selectedChat)),
    cachedChatKeys: Array.from(chatCache.recentChatCacheRef.current.keys()),
    chatAutoScrollEnabledRef: viewportState.chatAutoScrollEnabledRef,
    scrollChatContentToBottom: scroll.scrollChatContentToBottom,
    changesContainer: session.changesContainer,
    changesCwd: session.changesCwd,
    chatMediaTotalCount: session.activeSubagentChatView
      ? session.activeSubagentChatView.detail?.turnCount
      : chatState.chatDetail?.turnCount,
    chatMediaStartIndex: session.activeSubagentChatView
      ? (session.activeSubagentChatView.detail?.itemsStartTurnIndex ?? 0)
      : (chatState.chatDetail?.itemsStartTurnIndex ?? 0),
    activeSubagentChatView: session.activeSubagentChatView,
    chatHasActiveTurn: interactions.chatHasActiveTurn,
    chatLoadState: chatState.chatLoadState,
    chatSearchContentRef: searchState.chatSearchContentRef,
    chatTurnPageLoadDirection: chatState.chatTurnPageLoadDirection,
    commitChatReturnTarget: gitState.commitChatReturnTarget,
    contentRef: viewportState.contentRef,
    editingMessage: chatState.editingMessage,
    effectiveChatTurnWindow: conversation.effectiveChatTurnWindow,
    handleNativeChatContentScroll: conversation.handleNativeChatContentScroll,
    handleNativeChatContentWheel: conversation.handleNativeChatContentWheel,
    handleReturnFromAiCommitChat: commits.handleReturnFromAiCommitChat,
    handleReturnFromSubagentChat: subagents.handleReturnFromSubagentChat,
    handleNavigateSubagentTurns: subagents.handleNavigateSubagentTurns,
    loadChatTurnPage: conversation.loadChatTurnPage,
    renderChatTurn: turnRendering.renderChatTurn,
    renderSubagentChatTurn: turnRendering.renderSubagentChatTurn,
    renderedChatTurns: conversation.renderedChatTurns,
    selectedChat: chatState.selectedChat
      ? { id: chatState.selectedChat.id, providerId: chatState.selectedChat.providerId }
      : null,
    selectedChatCommitMarkers: session.selectedChatCommitMarkers,
    selectedChatKey: session.selectedChatKey,
    selectedChatSubagents: session.selectedChatSubagents,
    sendState: chatState.sendState,
    showChatTurnDownButton: turnRendering.showChatTurnDownButton,
    subagentChatConversationModel: conversation.subagentChatConversationModel,
    subagentContentRef: subagentState.subagentContentRef,
    subagentVisibleChatItems: conversation.subagentVisibleChatItems,
    visibleChatItems: conversation.visibleChatItems
  }
}
