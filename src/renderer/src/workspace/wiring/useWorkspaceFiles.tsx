import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceScroll } from '../features/useWorkspaceScroll'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceDialogState } from '../state/useWorkspaceDialogState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useFileNavigationController } from '../useFileNavigationController'
import { useWorkspaceChanges } from './useWorkspaceChanges'
import { useWorkspaceGitPresentation } from './useWorkspaceGitPresentation'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceFilesDependencies = {
  gitState: ReturnType<typeof useWorkspaceGitState>
  session: ReturnType<typeof useWorkspaceSession>
  changes: ReturnType<typeof useWorkspaceChanges>
  gitPresentation: ReturnType<typeof useWorkspaceGitPresentation>
  panes: ReturnType<typeof useWorkspacePanes>
  dialogState: ReturnType<typeof useWorkspaceDialogState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  scroll: ReturnType<typeof useWorkspaceScroll>
}

export function useWorkspaceFiles({
  gitState,
  session,
  changes,
  gitPresentation,
  panes,
  dialogState,
  chatState,
  viewportState,
  scroll
}: WorkspaceFilesDependencies) {
  const {
    handleCloseFileEditor,
    handleContinueReview,
    handleDeleteBranch,
    handleDeleteBranchWorktree,
    handleDismissGitBranchError,
    handleForceDeleteBranch,
    handleGoToPinnedText,
    handleOpenAttachment,
    handleOpenFileLink,
    handleReorderPinnedRecentReferences,
    handleReviewCommentsChange,
    handleSelectFileEditorTarget,
    handleSelectedReviewChange,
    handleSwitchBranch,
    handleToggleActiveTreeFolders,
    handleToggleChatMessagePinned,
    handleToggleRecentReferencePinned,
    handleUnpinAllRecentReferences,
    renderChangeTreeNode,
    renderRepositoryFileTreeNode
  } = useFileNavigationController({
    setCollapsedChangeTreeFolders: gitState.setCollapsedChangeTreeFolders,
    collapsedFileTreeFolders: gitState.collapsedFileTreeFolders,
    setCollapsedFileTreeFolders: gitState.setCollapsedFileTreeFolders,
    changesCwd: session.changesCwd,
    collapsedFileTreeFoldersByCwdRef: gitState.collapsedFileTreeFoldersByCwdRef,
    repositoryFileIndex: changes.repositoryFileIndex,
    branchSwitchDisabled: gitPresentation.branchSwitchDisabled,
    gitBranchRequestIdRef: gitState.gitBranchRequestIdRef,
    setGitBranchActionState: gitState.setGitBranchActionState,
    setGitBranchError: gitState.setGitBranchError,
    setGitBranchDeleteRetry: gitState.setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry: gitState.setGitBranchWorktreeDeleteRetry,
    changesContainer: session.changesContainer,
    setGitBranches: gitState.setGitBranches,
    setGitBranchesScope: gitState.setGitBranchesScope,
    gitAvailabilityScopeKey: session.gitAvailabilityScopeKey,
    setGitBranchLoadState: gitState.setGitBranchLoadState,
    setGitChangeLoadRequest: gitState.setGitChangeLoadRequest,
    setFileTreeLoadRequest: gitState.setFileTreeLoadRequest,
    gitBranchDeleteRetry: gitState.gitBranchDeleteRetry,
    gitBranchWorktreeDeleteRetry: gitState.gitBranchWorktreeDeleteRetry,
    gitBranchActionState: gitState.gitBranchActionState,
    activeTreeFolderPaths: gitPresentation.activeTreeFolderPaths,
    hasCollapsedActiveTreeFolders: gitPresentation.hasCollapsedActiveTreeFolders,
    changesPaneView: panes.changesPaneView,
    setFileEditorTarget: dialogState.setFileEditorTarget,
    setRecentlyOpenedFilesByWorkspace: chatState.setRecentlyOpenedFilesByWorkspace,
    selectedChatKey: session.selectedChatKey,
    setPinnedRecentChatReferences: chatState.setPinnedRecentChatReferences,
    selectedChatRef: chatState.selectedChatRef,
    handleChangesPaneViewChange: session.handleChangesPaneViewChange,
    selectedChatKeyRef: chatState.selectedChatKeyRef,
    pendingPinnedMessageNavigationRef: viewportState.pendingPinnedMessageNavigationRef,
    scrollPinnedChatMessageIntoView: scroll.scrollPinnedChatMessageIntoView,
    chatDetailRef: chatState.chatDetailRef,
    chatTurnPageLoadRequestRef: viewportState.chatTurnPageLoadRequestRef,
    chatTurnPageLoadInFlightRef: viewportState.chatTurnPageLoadInFlightRef,
    chatTurnScrollDirectionRef: viewportState.chatTurnScrollDirectionRef,
    pendingChatScrollAnchorRef: viewportState.pendingChatScrollAnchorRef,
    chatViewportAnchorRef: viewportState.chatViewportAnchorRef,
    chatAutoScrollEnabledRef: viewportState.chatAutoScrollEnabledRef,
    chatAutoScrollTargetRef: viewportState.chatAutoScrollTargetRef,
    chatTurnWindowRef: chatState.chatTurnWindowRef,
    setChatTurnPageLoadDirection: chatState.setChatTurnPageLoadDirection,
    setChatAtConversationBottom: chatState.setChatAtConversationBottom,
    setChatDetail: chatState.setChatDetail,
    setChatTurnWindow: chatState.setChatTurnWindow,
    setReviewCommentsDraft: dialogState.setReviewCommentsDraft,
    setSelectedReview: dialogState.setSelectedReview,
    getChangeTreeRowStyle: gitPresentation.getChangeTreeRowStyle,
    collapsedChangeTreeFolders: gitState.collapsedChangeTreeFolders
  })
  return {
    handleCloseFileEditor,
    handleContinueReview,
    handleDeleteBranch,
    handleDeleteBranchWorktree,
    handleDismissGitBranchError,
    handleForceDeleteBranch,
    handleGoToPinnedText,
    handleOpenAttachment,
    handleOpenFileLink,
    handleReorderPinnedRecentReferences,
    handleReviewCommentsChange,
    handleSelectFileEditorTarget,
    handleSelectedReviewChange,
    handleSwitchBranch,
    handleToggleActiveTreeFolders,
    handleToggleChatMessagePinned,
    handleToggleRecentReferencePinned,
    handleUnpinAllRecentReferences,
    renderChangeTreeNode,
    renderRepositoryFileTreeNode
  }
}
