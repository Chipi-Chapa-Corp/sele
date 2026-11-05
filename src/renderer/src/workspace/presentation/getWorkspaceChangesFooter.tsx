import { commitActionLabels } from '../controllerTypes'
import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { getGitRecoveryActionIcon, getGitRecoveryRememberLabel } from '../gitControllerUtils'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceChanges } from '../wiring/useWorkspaceChanges'
import { useWorkspaceCommits } from '../wiring/useWorkspaceCommits'
import { useWorkspaceGitPresentation } from '../wiring/useWorkspaceGitPresentation'
import { useWorkspaceGitSync } from '../wiring/useWorkspaceGitSync'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'

type WorkspaceChangesFooterDependencies = {
  panes: ReturnType<typeof useWorkspacePanes>
  gitPresentation: ReturnType<typeof useWorkspaceGitPresentation>
  gitState: ReturnType<typeof useWorkspaceGitState>
  session: ReturnType<typeof useWorkspaceSession>
  commits: ReturnType<typeof useWorkspaceCommits>
  gitSync: ReturnType<typeof useWorkspaceGitSync>
  changes: ReturnType<typeof useWorkspaceChanges>
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
    commitActionLabels,
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
    getGitRecoveryActionIcon,
    getGitRecoveryRememberLabel,
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
    handleSyncChanges: (action) => gitSync.handleSyncChanges(action),
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
