import { conversationViews } from '../../conversationViews'
import { useWorkspaceChatCache } from '../features/useWorkspaceChatCache'
import { useWorkspaceScroll } from '../features/useWorkspaceScroll'
import { useWorkspaceTurnRendering } from '../features/useWorkspaceTurnRendering'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useCommitController } from '../useCommitController'
import { useConversationViewModel } from '../useConversationViewModel'
import { useChatInteractionController } from '../useChatInteractionController'
import { useWorkspaceSelection } from '../useWorkspaceSelection'
import { useSubagentController } from '../useSubagentController'

type WorkspaceConversationMessagesDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  chatCache: ReturnType<typeof useWorkspaceChatCache>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  scroll: ReturnType<typeof useWorkspaceScroll>
  session: ReturnType<typeof useWorkspaceSelection>
  interactions: ReturnType<typeof useChatInteractionController>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  gitState: ReturnType<typeof useWorkspaceGitState>
  conversation: ReturnType<typeof useConversationViewModel>
  commits: ReturnType<typeof useCommitController>
  subagents: ReturnType<typeof useSubagentController>
  turnRendering: ReturnType<typeof useWorkspaceTurnRendering>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
}

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
}: WorkspaceConversationMessagesDependencies) {
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
