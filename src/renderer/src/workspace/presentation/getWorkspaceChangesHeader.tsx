import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function getWorkspaceChangesHeader({
  gitHubPullRequests,
  panes,
  settings,
  gitPresentation,
  changes,
  session,
  gitState,
  files,
  gitSync,
  chrome
}: WorkspaceChanges) {
  return {
    gitHubPullRequests,
    gitPaneView: panes.gitPaneView,
    setGitPaneView: panes.setGitPaneView,
    noProject: settings.noProject,
    activeSidebarLoadState: gitPresentation.activeSidebarLoadState,
    activeTreeFolderPaths: gitPresentation.activeTreeFolderPaths,
    branchNames: changes.branchNames,
    branchSwitchDisabled: gitPresentation.branchSwitchDisabled,
    changesCwd: session.changesCwd,
    changesPaneView: panes.changesPaneView,
    changesSidebarExpanded: panes.changesSidebarExpanded,
    currentBranchName: changes.currentBranchName,
    effectiveAppSettings: settings.effectiveAppSettings,
    gitBranchActionState: gitPresentation.branchActionInProgress
      ? ('sending' as const)
      : gitState.gitBranchActionState,
    gitBranchDeleteRetry: gitState.gitBranchDeleteRetry,
    gitBranchError: gitState.gitBranchError,
    gitBranchLoadState: gitState.gitBranchLoadState,
    gitBranchWorktreeDeleteRetry: gitState.gitBranchWorktreeDeleteRetry,
    handleChangesPaneViewChange: session.handleChangesPaneViewChange,
    handleDeleteBranch: files.handleDeleteBranch,
    handleDeleteBranchWorktree: files.handleDeleteBranchWorktree,
    handleDismissGitBranchError: files.handleDismissGitBranchError,
    handleForceDeleteBranch: files.handleForceDeleteBranch,
    handleGitBranchErrorAiResolution: gitSync.handleGitBranchErrorAiResolution,
    handleSwitchBranch: files.handleSwitchBranch,
    handleToggleActiveTreeFolders: files.handleToggleActiveTreeFolders,
    hasCollapsedActiveTreeFolders: gitPresentation.hasCollapsedActiveTreeFolders,
    refreshSidebarLabel: gitPresentation.refreshSidebarLabel,
    renderGitAiResolutionButton: gitSync.renderGitAiResolutionButton,
    renderSettingsButton: chrome.renderSettingsButton,
    renderWindowControls: chrome.renderWindowControls,
    setChangesSidebarExpanded: panes.setChangesSidebarExpanded,
    setFileTreeLoadRequest: gitState.setFileTreeLoadRequest,
    setGitBranchLoadRequest: gitState.setGitBranchLoadRequest,
    setGitChangeLoadRequest: gitState.setGitChangeLoadRequest,
    treeToggleLabel: gitPresentation.treeToggleLabel
  }
}
