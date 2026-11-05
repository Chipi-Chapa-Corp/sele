import { useWorkspaceChatReadState } from '../features/useWorkspaceChatReadState'
import { useWorkspaceScroll } from '../features/useWorkspaceScroll'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useSubagentController } from '../useSubagentController'
import { useWorkspaceCommits } from './useWorkspaceCommits'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceSubagentsDependencies = {
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  session: ReturnType<typeof useWorkspaceSession>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  scroll: ReturnType<typeof useWorkspaceScroll>
  gitState: ReturnType<typeof useWorkspaceGitState>
  commits: ReturnType<typeof useWorkspaceCommits>
}

export function useWorkspaceSubagents({
  viewportState,
  chatRead,
  session,
  subagentState,
  searchState,
  chatState,
  scroll,
  gitState,
  commits
}: WorkspaceSubagentsDependencies) {
  const {
    handleNavigateSubagentTurns,
    handleLoadSubagentWorkingStep,
    handleLoadSubagentWorkingItem,
    handleLoadSubagentWorkingToolPage,
    handleReturnFromSubagentChat,
    handleReturnToRootChat,
    renderChatCommitMarker,
    handleOpenSubagentChat,
    handleCancelSubagent
  } = useSubagentController({
    chatAutoScrollEnabledRef: viewportState.chatAutoScrollEnabledRef,
    chatViewportAnchorRef: viewportState.chatViewportAnchorRef,
    chatScrollAdjustmentTargetRef: viewportState.chatScrollAdjustmentTargetRef,
    previousChatScrollTopRef: viewportState.previousChatScrollTopRef,
    markSelectedChatSeen: chatRead.markSelectedChatSeen,
    activeSubagentChatView: session.activeSubagentChatView,
    selectedProviderId: session.selectedProviderId,
    selectedChatId: session.selectedChatId,
    selectedChatKey: session.selectedChatKey,
    subagentChatLoadRequestRef: subagentState.subagentChatLoadRequestRef,
    resetChatSearch: searchState.resetChatSearch,
    setEditingMessage: chatState.setEditingMessage,
    setSubagentChatView: subagentState.setSubagentChatView,
    selectedChatKeyRef: chatState.selectedChatKeyRef,
    subagentContentRef: subagentState.subagentContentRef,
    scrollChatContentToBottom: scroll.scrollChatContentToBottom,
    cancelingSubagentIds: subagentState.cancelingSubagentIds,
    setCancelingSubagentIds: subagentState.setCancelingSubagentIds,
    setSubagentListState: subagentState.setSubagentListState,
    contentRef: viewportState.contentRef,
    scopedCommitActivitiesByMarkerId: session.scopedCommitActivitiesByMarkerId,
    cancelingAiCommitKeys: gitState.cancelingAiCommitKeys,
    openingAiCommitChatIds: gitState.openingAiCommitChatIds,
    handleCancelAiCommit: commits.handleCancelAiCommit,
    handleOpenAiCommitChat: commits.handleOpenAiCommitChat,
    subagents: session.selectedChatSubagents
  })
  return {
    handleNavigateSubagentTurns,
    handleLoadSubagentWorkingStep,
    handleLoadSubagentWorkingItem,
    handleLoadSubagentWorkingToolPage,
    handleReturnFromSubagentChat,
    handleReturnToRootChat,
    renderChatCommitMarker,
    handleOpenSubagentChat,
    handleCancelSubagent
  }
}
