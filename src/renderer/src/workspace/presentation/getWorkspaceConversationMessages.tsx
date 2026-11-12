import { conversationViews } from '../../conversationViews'
import type { StartingChat } from '../../startingChat'
import { useWorkspaceChatCache } from '../features/useWorkspaceChatCache'
import { useWorkspaceScroll } from '../features/useWorkspaceScroll'
import { useWorkspaceTurnRendering } from '../features/useWorkspaceTurnRendering'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useWorkspaceCommits } from '../wiring/useWorkspaceCommits'
import { useWorkspaceConversation } from '../wiring/useWorkspaceConversation'
import { useWorkspaceInteractions } from '../wiring/useWorkspaceInteractions'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'
import { useWorkspaceSubagents } from '../wiring/useWorkspaceSubagents'

type WorkspaceConversationMessagesDependencies = {
  startingChat: StartingChat | null
  chatState: ReturnType<typeof useWorkspaceChatState>
  chatCache: ReturnType<typeof useWorkspaceChatCache>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  scroll: ReturnType<typeof useWorkspaceScroll>
  session: ReturnType<typeof useWorkspaceSession>
  interactions: ReturnType<typeof useWorkspaceInteractions>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  gitState: ReturnType<typeof useWorkspaceGitState>
  conversation: ReturnType<typeof useWorkspaceConversation>
  commits: ReturnType<typeof useWorkspaceCommits>
  subagents: ReturnType<typeof useWorkspaceSubagents>
  turnRendering: ReturnType<typeof useWorkspaceTurnRendering>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
}

export function getWorkspaceConversationMessages({
  startingChat,
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
    startingChat,
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
    handleReturnFromSubagentChat: () => subagents.handleReturnFromSubagentChat(),
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
