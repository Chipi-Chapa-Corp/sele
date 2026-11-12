import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useChangesData } from '../useChangesData'
import { useCommitController } from '../useCommitController'
import { useGitViewModel } from '../useGitViewModel'
import { useGitSyncController } from '../useGitSyncController'
import { useWorkspaceSelection } from '../useWorkspaceSelection'

type WorkspaceChangesFooterDependencies = {
  panes: ReturnType<typeof useWorkspacePanes>
  gitPresentation: ReturnType<typeof useGitViewModel>
  gitState: ReturnType<typeof useWorkspaceGitState>
  session: ReturnType<typeof useWorkspaceSelection>
  commits: ReturnType<typeof useCommitController>
  gitSync: ReturnType<typeof useGitSyncController>
  changes: ReturnType<typeof useChangesData>
}

export function getWorkspaceChangesFooter({
  panes,
  gitPresentation,
  gitState,
  session,
  commits,
  gitSync,
  changes
}: WorkspaceChangesFooterDependencies) {
  return {
    visible: panes.changesPaneView === 'git' && panes.gitPaneView === 'changes',
    commitDisabled: gitPresentation.commitDisabled,
    commitInput: gitState.commitInput,
    commitInputLabel: gitPresentation.commitInputLabel,
    commitMessageGenerationDisabled: gitPresentation.commitMessageGenerationDisabled,
    commitMessageGenerationInProgress: gitPresentation.commitMessageGenerationInProgress,
    currentProjectCommitError: gitPresentation.currentProjectCommitError,
    currentProjectKey: gitPresentation.currentProjectKey,
    currentProjectSyncError: gitPresentation.currentProjectSyncError,
    directProjectCommitInProgress: gitPresentation.directProjectCommitInProgress,
    navigationKey: `${session.selectedChatKey ?? ''}|${gitPresentation.currentProjectKey}`,
    getAiCommitActionDisabled: gitPresentation.getAiCommitActionDisabled,
    gitCommitModeToggle: gitPresentation.gitCommitModeToggle,
    handleAiCommitChangedFiles: commits.handleAiCommitChangedFiles,
    handleDismissGitCommitError: gitSync.handleDismissGitCommitError,
    handleDismissGitSyncRecovery: gitSync.handleDismissGitSyncRecovery,
    handleDismissUnclassifiedGitSyncError: gitSync.handleDismissUnclassifiedGitSyncError,
    handleGenerateCommitMessage: commits.handleGenerateCommitMessage,
    handleGitAiResolution: gitSync.handleGitAiResolution,
    handleGitCommitErrorAiResolution: gitSync.handleGitCommitErrorAiResolution,
    handleGitSyncRecoveryAction: gitSync.handleGitSyncRecoveryAction,
    handleManualCommitChangedFiles: commits.handleManualCommitChangedFiles,
    handleQuickCommitChangedFiles: commits.handleQuickCommitChangedFiles,
    handleSyncChanges: gitSync.handleSyncChanges,
    handleUnclassifiedGitSyncAiResolution: gitSync.handleUnclassifiedGitSyncAiResolution,
    hasSyncChanges: changes.hasSyncChanges,
    primarySyncAction: changes.primarySyncAction,
    projectCommitInProgress: gitPresentation.projectCommitInProgress,
    pushAfterCommit: gitPresentation.pushAfterCommit,
    renderGitAiResolutionButton: gitSync.renderGitAiResolutionButton,
    setCommitErrorsByProjectKey: gitState.setCommitErrorsByProjectKey,
    setCommitInput: gitState.setCommitInput,
    showCommitInput: gitPresentation.showCommitInput,
    showManualCommit: gitPresentation.showManualCommit,
    syncButtonTitle: changes.syncButtonTitle,
    syncDisabled: gitPresentation.syncDisabled,
    syncDropdownActions: gitPresentation.syncDropdownActions,
    syncInProgress: gitPresentation.syncInProgress,
    unpulledCount: changes.unpulledCount,
    unpushedCount: changes.unpushedCount,
    visibleSyncRecovery: gitPresentation.visibleSyncRecovery,
    visibleSyncRecoveryActions: gitPresentation.visibleSyncRecoveryActions
  }
}
