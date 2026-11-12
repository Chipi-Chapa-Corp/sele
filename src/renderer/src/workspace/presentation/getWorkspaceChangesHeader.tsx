import { useWorkspaceChrome } from '../features/useWorkspaceChrome'
import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useGitHubPullRequests } from '../useGitHubPullRequests'
import { useChangesData } from '../useChangesData'
import { useFileNavigationController } from '../useFileNavigationController'
import { useGitViewModel } from '../useGitViewModel'
import { useGitSyncController } from '../useGitSyncController'
import { useWorkspaceSelection } from '../useWorkspaceSelection'

type WorkspaceChangesHeaderDependencies = {
  gitHubPullRequests: ReturnType<typeof useGitHubPullRequests>
  panes: ReturnType<typeof useWorkspacePanes>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  gitPresentation: ReturnType<typeof useGitViewModel>
  changes: ReturnType<typeof useChangesData>
  session: ReturnType<typeof useWorkspaceSelection>
  gitState: ReturnType<typeof useWorkspaceGitState>
  files: ReturnType<typeof useFileNavigationController>
  gitSync: ReturnType<typeof useGitSyncController>
  chrome: ReturnType<typeof useWorkspaceChrome>
}

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
}: WorkspaceChangesHeaderDependencies) {
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
