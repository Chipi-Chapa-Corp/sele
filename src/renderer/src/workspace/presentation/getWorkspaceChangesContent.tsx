import { getChatKey } from '../chatControllerUtils'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function getWorkspaceChangesContent({
  gitHubPullRequests,
  panes,
  browser,
  chatState,
  dialogState,
  session,
  gitPresentation,
  changes,
  conversation,
  settings,
  gitState,
  gitSync,
  benchmark,
  primaryWorktreeChanges,
  secondaryWorktreeChanges,
  primaryWorktreeFiles,
  secondaryWorktreeFiles,
  files
}: WorkspaceChanges) {
  return {
    gitHubPullRequests,
    benchmarkActive: benchmark.active,
    benchmarkBranchSwitchDisabled:
      gitPresentation.branchSwitchDisabled ||
      benchmark.working ||
      benchmark.busy ||
      chatState.sendState === 'sending',
    primaryWorktreeTree:
      panes.changesPaneView === 'files' ? primaryWorktreeFiles : primaryWorktreeChanges,
    secondaryWorktreeTree:
      panes.changesPaneView === 'files' ? secondaryWorktreeFiles : secondaryWorktreeChanges,
    changesContainerKey: session.changesContainerKey,
    handleSwitchBenchmarkBranch: files.handleSwitchBenchmarkBranch,
    handleSelectFileEditorTarget: files.handleSelectFileEditorTarget,
    gitPaneView: panes.gitPaneView,
    handleOpenBrowserRequest: browser.handleOpenBrowserRequest,
    terminalChatKey: chatState.selectedChat ? getChatKey(chatState.selectedChat) : null,
    browserOpenRequest: dialogState.browserOpenRequest,
    browserOpened: dialogState.browserOpened,
    browserWorkspaceKey: session.browserWorkspaceKey,
    changeTree: gitPresentation.changeTree,
    changedFiles: changes.changedFiles,
    changesContainer: session.changesContainer,
    changesCwd: session.changesCwd,
    changesEmptyMessage: gitPresentation.changesEmptyMessage,
    changesPaneView: panes.changesPaneView,
    changesProjectCwd: session.changesProjectCwd,
    displayedGitChangeLoadError: changes.displayedGitChangeLoadError,
    displayedRecentChatReferences: conversation.displayedRecentChatReferences,
    effectiveAppSettings: settings.effectiveAppSettings,
    filesEmptyMessage: gitPresentation.filesEmptyMessage,
    fileTreeLoadError: gitState.fileTreeLoadError,
    setFileTreeLoadRequest: gitState.setFileTreeLoadRequest,
    handleDismissGitChangeLoadError: gitSync.handleDismissGitChangeLoadError,
    handleGitChangeLoadErrorAiResolution: gitSync.handleGitChangeLoadErrorAiResolution,
    handleGoToPinnedText: files.handleGoToPinnedText,
    handleOpenFileLink: files.handleOpenFileLink,
    handleReorderPinnedRecentReferences: files.handleReorderPinnedRecentReferences,
    handleSolveUntrackedFiles: gitSync.handleSolveUntrackedFiles,
    handleToggleRecentReferencePinned: files.handleToggleRecentReferencePinned,
    handleUnpinAllRecentReferences: files.handleUnpinAllRecentReferences,
    recentlyOpenedFiles: conversation.recentlyOpenedFiles,
    renderChangeTreeNode: files.renderChangeTreeNode,
    renderGitAiResolutionButton: gitSync.renderGitAiResolutionButton,
    renderRepositoryFileTreeNode: files.renderRepositoryFileTreeNode,
    repositoryFileCount: changes.repositoryFileCount,
    repositoryFileTree: gitPresentation.repositoryFileTree,
    setGitChangeLoadRequest: gitState.setGitChangeLoadRequest,
    terminalCommandLaunchRequest: dialogState.terminalCommandLaunchRequest,
    terminalOpened: dialogState.terminalOpened,
    terminalWorkspaceKey: session.terminalWorkspaceKey,
    untrackedFilesAiDisabled: gitPresentation.untrackedFilesAiDisabled,
    untrackedFilesHiddenForPerformance: changes.untrackedFilesHiddenForPerformance,
    visibleChangesLoadState: changes.visibleChangesLoadState,
    visibleFilesLoadState: changes.visibleFilesLoadState,
    visibleGitChangeLoadError: changes.visibleGitChangeLoadError
  }
}
