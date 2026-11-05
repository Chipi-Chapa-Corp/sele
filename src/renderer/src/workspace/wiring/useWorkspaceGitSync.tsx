import { getChatCwdGroupKey } from '../chatControllerUtils'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useGitSyncController } from '../useGitSyncController'
import { useWorkspaceChanges } from './useWorkspaceChanges'
import { useWorkspaceGitPresentation } from './useWorkspaceGitPresentation'
import { useWorkspaceMessaging } from './useWorkspaceMessaging'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceGitSyncDependencies = {
  gitState: ReturnType<typeof useWorkspaceGitState>
  session: ReturnType<typeof useWorkspaceSession>
  gitPresentation: ReturnType<typeof useWorkspaceGitPresentation>
  changes: ReturnType<typeof useWorkspaceChanges>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  messaging: ReturnType<typeof useWorkspaceMessaging>
  provider: ReturnType<typeof useWorkspaceProviderContext>
}

export function useWorkspaceGitSync({
  gitState,
  session,
  gitPresentation,
  changes,
  settings,
  messaging,
  provider
}: WorkspaceGitSyncDependencies) {
  const hasAiCommitInProgressForProject = (projectKey: string): boolean =>
    Boolean(gitState.startingScopedCommitActivitiesRef.current[projectKey]) ||
    Object.values(gitState.scopedCommitActivitiesRef.current).some(
      (activity) => getChatCwdGroupKey(activity.projectCwd) === projectKey
    )

  const {
    handleDismissGitChangeLoadError,
    handleDismissGitCommitError,
    handleDismissGitSyncRecovery,
    handleDismissUnclassifiedGitSyncError,
    handleGitAiResolution,
    handleGitBranchErrorAiResolution,
    handleGitChangeLoadErrorAiResolution,
    handleGitCommitErrorAiResolution,
    handleGitSyncRecoveryAction,
    handleSolveUntrackedFiles,
    handleSyncChanges,
    handleUnclassifiedGitSyncAiResolution,
    renderGitAiResolutionButton,
    runSyncChanges
  } = useGitSyncController({
    setSyncErrorsByProjectKey: gitState.setSyncErrorsByProjectKey,
    setSyncRecoveriesByProjectKey: gitState.setSyncRecoveriesByProjectKey,
    changesProjectCwd: session.changesProjectCwd,
    syncProjectKeysRef: gitState.syncProjectKeysRef,
    hasAiCommitInProgressForProject,
    commitInFlightProjectKeysRef: gitState.commitInFlightProjectKeysRef,
    commitMessageGenerationProjectKeysRef: gitState.commitMessageGenerationProjectKeysRef,
    setSyncProjectKeys: gitState.setSyncProjectKeys,
    changesContainer: session.changesContainer,
    setGitChangeLoadRequest: gitState.setGitChangeLoadRequest,
    syncDisabled: gitPresentation.syncDisabled,
    changesCwd: session.changesCwd,
    currentProjectKey: gitPresentation.currentProjectKey,
    visibleSyncRecovery: gitPresentation.visibleSyncRecovery,
    syncInProgress: gitPresentation.syncInProgress,
    visibleGitChangeLoadError: changes.visibleGitChangeLoadError,
    effectiveAppSettings: settings.effectiveAppSettings,
    gitAiResolutionDisabled: gitPresentation.gitAiResolutionDisabled,
    handleSendMessage: messaging.handleSendMessage,
    getGitTurnOptions: messaging.getGitTurnOptions,
    setGitChangeLoadErrorDismissed: gitState.setGitChangeLoadErrorDismissed,
    setCommitErrorsByProjectKey: gitState.setCommitErrorsByProjectKey,
    currentProjectSyncError: gitPresentation.currentProjectSyncError,
    currentProjectCommitError: gitPresentation.currentProjectCommitError,
    gitBranchError: gitState.gitBranchError,
    setGitBranchError: gitState.setGitBranchError,
    setGitBranchDeleteRetry: gitState.setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry: gitState.setGitBranchWorktreeDeleteRetry,
    gitBranchActionState: gitState.gitBranchActionState,
    setGitBranchActionState: gitState.setGitBranchActionState,
    configProviderId: provider.configProviderId,
    untrackedFilesHiddenForPerformance: changes.untrackedFilesHiddenForPerformance,
    untrackedFilesAiDisabled: gitPresentation.untrackedFilesAiDisabled
  })
  return {
    hasAiCommitInProgressForProject,
    handleDismissGitChangeLoadError,
    handleDismissGitCommitError,
    handleDismissGitSyncRecovery,
    handleDismissUnclassifiedGitSyncError,
    handleGitAiResolution,
    handleGitBranchErrorAiResolution,
    handleGitChangeLoadErrorAiResolution,
    handleGitCommitErrorAiResolution,
    handleGitSyncRecoveryAction,
    handleSolveUntrackedFiles,
    handleSyncChanges,
    handleUnclassifiedGitSyncAiResolution,
    renderGitAiResolutionButton,
    runSyncChanges
  }
}
