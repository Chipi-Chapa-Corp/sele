import { useWorkspaceChrome } from '../features/useWorkspaceChrome'
import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useGitHubPullRequests } from '../useGitHubPullRequests'
import { useWorkspaceChanges } from '../wiring/useWorkspaceChanges'
import { useWorkspaceFiles } from '../wiring/useWorkspaceFiles'
import { useWorkspaceGitPresentation } from '../wiring/useWorkspaceGitPresentation'
import { useWorkspaceGitSync } from '../wiring/useWorkspaceGitSync'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'

type WorkspaceChangesHeaderDependencies = {
  gitHubPullRequests: ReturnType<typeof useGitHubPullRequests>
  panes: ReturnType<typeof useWorkspacePanes>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  gitPresentation: ReturnType<typeof useWorkspaceGitPresentation>
  changes: ReturnType<typeof useWorkspaceChanges>
  session: ReturnType<typeof useWorkspaceSession>
  gitState: ReturnType<typeof useWorkspaceGitState>
  files: ReturnType<typeof useWorkspaceFiles>
  gitSync: ReturnType<typeof useWorkspaceGitSync>
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
    gitBranchActionState: gitState.gitBranchActionState,
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
