import type { GitSyncAction } from '../controllerTypes'
import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useGitViewModel } from '../useGitViewModel'
import { useWorkspaceChanges } from './useWorkspaceChanges'
import { useWorkspaceInteractions } from './useWorkspaceInteractions'
import { useWorkspaceProviderUpdates } from './useWorkspaceProviderUpdates'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceGitPresentationDependencies = {
  gitState: ReturnType<typeof useWorkspaceGitState>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  session: ReturnType<typeof useWorkspaceSession>
  chatState: ReturnType<typeof useWorkspaceChatState>
  interactions: ReturnType<typeof useWorkspaceInteractions>
  changes: ReturnType<typeof useWorkspaceChanges>
  providerUpdates: ReturnType<typeof useWorkspaceProviderUpdates>
  handleSyncChanges: (action: GitSyncAction) => Promise<void>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  panes: ReturnType<typeof useWorkspacePanes>
}

export function useWorkspaceGitPresentation({
  gitState,
  settings,
  session,
  chatState,
  interactions,
  changes,
  providerUpdates,
  handleSyncChanges,
  sourceState,
  panes
}: WorkspaceGitPresentationDependencies) {
  const {
    activeSidebarLoadState,
    activeTreeFolderPaths,
    aiCommitInstructions,
    branchActionInProgress,
    branchSwitchDisabled,
    changeTree,
    changesEmptyMessage,
    commitDisabled,
    commitInputLabel,
    commitInputValue,
    commitMessageGenerationDisabled,
    commitMessageGenerationInProgress,
    currentProjectCommitError,
    currentProjectKey,
    currentProjectSyncError,
    directProjectCommitInProgress,
    filesEmptyMessage,
    getAiCommitActionDisabled,
    getChangeTreeRowStyle,
    getCommitActionDisabled,
    gitAiResolutionDisabled,
    gitCommitModeToggle,
    hasCollapsedActiveTreeFolders,
    projectCommitInProgress,
    pushAfterCommit,
    refreshSidebarLabel,
    repositoryFileTree,
    showCommitInput,
    showManualCommit,
    syncDisabled,
    syncDropdownActions,
    syncInProgress,
    treeToggleLabel,
    untrackedFilesAiDisabled,
    visibleSyncRecovery,
    visibleSyncRecoveryActions
  } = useGitViewModel({
    commitInput: gitState.commitInput,
    effectiveAppSettings: settings.effectiveAppSettings,
    gitCommitMode: gitState.gitCommitMode,
    changesProjectCwd: session.changesProjectCwd,
    changesCwd: session.changesCwd,
    visibleGitErrorProjectKeyRef: gitState.visibleGitErrorProjectKeyRef,
    setCommitErrorsByProjectKey: gitState.setCommitErrorsByProjectKey,
    setSyncErrorsByProjectKey: gitState.setSyncErrorsByProjectKey,
    setSyncRecoveriesByProjectKey: gitState.setSyncRecoveriesByProjectKey,
    syncProjectKeys: gitState.syncProjectKeys,
    syncErrorsByProjectKey: gitState.syncErrorsByProjectKey,
    syncRecoveriesByProjectKey: gitState.syncRecoveriesByProjectKey,
    commitMessageGenerationProjectKeys: gitState.commitMessageGenerationProjectKeys,
    commitErrorsByProjectKey: gitState.commitErrorsByProjectKey,
    scopedCommitActivities: gitState.scopedCommitActivities,
    directCommitActivities: gitState.directCommitActivities,
    startingScopedCommitActivities: gitState.startingScopedCommitActivities,
    sendState: chatState.sendState,
    sendInFlightProjectKey: chatState.sendInFlightProjectKey,
    editingMessage: chatState.editingMessage,
    selectedChat: chatState.selectedChat,
    chatDetail: chatState.chatDetail,
    chatLoadState: chatState.chatLoadState,
    chatIsBusy: interactions.chatIsBusy,
    changedFiles: changes.changedFiles,
    untrackedFilesHiddenForPerformance: changes.untrackedFilesHiddenForPerformance,
    providerUpdateInProgress: providerUpdates.providerUpdateInProgress,
    changesLoadState: changes.changesLoadState,
    uncommittedChangedFiles: changes.uncommittedChangedFiles,
    gitAvailableForCurrentSource: session.gitAvailableForCurrentSource,
    setGitCommitMode: gitState.setGitCommitMode,
    branchActionProjectKeys: gitState.branchActionProjectKeys,
    hasUnpulledChanges: changes.hasUnpulledChanges,
    unpulledCount: changes.unpulledCount,
    handleSyncChanges: (...args) => handleSyncChanges(...args),
    hasUnpushedChanges: changes.hasUnpushedChanges,
    unpushedCount: changes.unpushedCount,
    chatHasActiveTurn: interactions.chatHasActiveTurn,
    newSessionProviderAvailable: sourceState.newSessionProviderAvailable,
    changeSource: panes.changeSource,
    repositoryFileIndex: changes.repositoryFileIndex,
    changesPaneView: panes.changesPaneView,
    collapsedFileTreeFolders: gitState.collapsedFileTreeFolders,
    collapsedChangeTreeFolders: gitState.collapsedChangeTreeFolders,
    filesLoadState: changes.filesLoadState
  })
  return {
    activeSidebarLoadState,
    activeTreeFolderPaths,
    aiCommitInstructions,
    branchActionInProgress,
    branchSwitchDisabled,
    changeTree,
    changesEmptyMessage,
    commitDisabled,
    commitInputLabel,
    commitInputValue,
    commitMessageGenerationDisabled,
    commitMessageGenerationInProgress,
    currentProjectCommitError,
    currentProjectKey,
    currentProjectSyncError,
    directProjectCommitInProgress,
    filesEmptyMessage,
    getAiCommitActionDisabled,
    getChangeTreeRowStyle,
    getCommitActionDisabled,
    gitAiResolutionDisabled,
    gitCommitModeToggle,
    hasCollapsedActiveTreeFolders,
    projectCommitInProgress,
    pushAfterCommit,
    refreshSidebarLabel,
    repositoryFileTree,
    showCommitInput,
    showManualCommit,
    syncDisabled,
    syncDropdownActions,
    syncInProgress,
    treeToggleLabel,
    untrackedFilesAiDisabled,
    visibleSyncRecovery,
    visibleSyncRecoveryActions
  }
}
