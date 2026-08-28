import { Sparkles } from 'lucide-react'
import type {
  AppGitPullStrategy,
  AppGitPushTarget,
  AppGitRecoverableFailure,
  AppGitRecoveryActionId
} from '../../../shared/app'
import { Button } from '../components/Button'
import { appApi } from '../appApi'
import { getGitAiResolutionPrompt } from '../gitErrorResolution'
import { providerLabels } from '../providerSettings'
import {
  type GitSyncAction,
  type GitSyncRecoveryActionOptions,
  type GitSyncRecoveryState,
  type GitSyncStep
} from './controllerTypes'
import { getGitRecoveryAiResolutionPrompt, getGitRecoveryPullStrategy } from './gitControllerUtils'
import { getChatCwdGroupKey, getErrorMessage } from './chatControllerUtils'
import type { GitSyncControllerDependencies } from './controllerDependencies'

// Return shape is inferred from the controller declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useGitSyncController(dependencies: GitSyncControllerDependencies) {
  const {
    setSyncErrorsByProjectKey,
    setSyncRecoveriesByProjectKey,
    providerUpdateInProgress,
    changesProjectCwd,
    syncProjectKeysRef,
    hasAiCommitInProgressForProject,
    commitInFlightProjectKeysRef,
    commitMessageGenerationProjectKeysRef,
    setSyncProjectKeys,
    changesContainer,
    setGitChangeLoadRequest,
    syncDisabled,
    changesCwd,
    currentProjectKey,
    visibleSyncRecovery,
    syncInProgress,
    visibleGitChangeLoadError,
    effectiveAppSettings,
    gitAiResolutionDisabled,
    handleSendMessage,
    getGitTurnOptions,
    setGitChangeLoadErrorDismissed,
    setCommitErrorsByProjectKey,
    currentProjectSyncError,
    currentProjectCommitError,
    gitBranchError,
    setGitBranchError,
    setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry,
    gitBranchActionState,
    setGitBranchActionState,
    configProviderId,
    untrackedFilesHiddenForPerformance,
    untrackedFilesAiDisabled
  } = dependencies

  const showRecoverableGitFailure = (
    projectKey: string,
    cwd: string,
    requestedAction: GitSyncAction,
    failedAction: GitSyncStep,
    failure: AppGitRecoverableFailure
  ): void => {
    setSyncErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[projectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[projectKey]
      return nextErrors
    })
    setSyncRecoveriesByProjectKey((currentRecoveries) => ({
      ...currentRecoveries,
      [projectKey]: {
        cwd,
        requestedAction,
        failedAction,
        failure,
        error: null
      }
    }))
  }
  const runSyncChanges = async (
    action: GitSyncAction,
    cwd: string,
    options: {
      pullStrategy?: AppGitPullStrategy
      pushTarget?: AppGitPushTarget
      rememberPushTarget?: boolean
      rememberStrategy?: boolean
      setUpstream?: boolean
      recovery?: GitSyncRecoveryState | null
    } = {}
  ): Promise<void> => {
    if (providerUpdateInProgress) return

    const operationProjectKey = getChatCwdGroupKey(changesProjectCwd ?? cwd)
    if (
      syncProjectKeysRef.current.has(operationProjectKey) ||
      hasAiCommitInProgressForProject(operationProjectKey) ||
      commitInFlightProjectKeysRef.current.has(operationProjectKey) ||
      commitMessageGenerationProjectKeysRef.current.has(operationProjectKey)
    ) {
      return
    }

    const nextSyncProjectKeys = new Set(syncProjectKeysRef.current).add(operationProjectKey)
    syncProjectKeysRef.current = nextSyncProjectKeys
    setSyncProjectKeys(nextSyncProjectKeys)
    setSyncErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[operationProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[operationProjectKey]
      return nextErrors
    })
    setSyncRecoveriesByProjectKey((currentRecoveries) => {
      const nextRecoveries = { ...currentRecoveries }
      if (options.recovery) {
        nextRecoveries[operationProjectKey] = { ...options.recovery, error: null }
      } else {
        delete nextRecoveries[operationProjectKey]
      }
      return nextRecoveries
    })

    let currentAction: GitSyncStep = action === 'push' ? 'push' : 'pull'

    try {
      if (action === 'pull' || action === 'pullAndPush') {
        currentAction = 'pull'
        const pullResult = await appApi.pullGitChanges({
          container: changesContainer,
          cwd,
          rememberStrategy: options.rememberStrategy,
          strategy: options.pullStrategy
        })

        if (pullResult.failure) {
          showRecoverableGitFailure(operationProjectKey, cwd, action, 'pull', pullResult.failure)
          return
        }
      }

      if (action === 'push' || action === 'pullAndPush') {
        currentAction = 'push'
        const pushResult = await appApi.pushGitChanges({
          container: changesContainer,
          cwd,
          rememberTarget: options.rememberPushTarget,
          target: options.pushTarget,
          setUpstream: options.setUpstream
        })

        if (pushResult.failure) {
          showRecoverableGitFailure(operationProjectKey, cwd, action, 'push', pushResult.failure)
          return
        }
      }

      setSyncRecoveriesByProjectKey((currentRecoveries) => {
        if (!currentRecoveries[operationProjectKey]) return currentRecoveries

        const nextRecoveries = { ...currentRecoveries }
        delete nextRecoveries[operationProjectKey]
        return nextRecoveries
      })
      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
    } catch (error) {
      const message = getErrorMessage(
        error,
        currentAction === 'pull' ? 'Unable to pull changes.' : 'Unable to push changes.'
      )

      const recovery = options.recovery
      if (recovery) {
        setSyncRecoveriesByProjectKey((currentRecoveries) => ({
          ...currentRecoveries,
          [operationProjectKey]: { ...recovery, error: message }
        }))
        return
      }

      setSyncRecoveriesByProjectKey((currentRecoveries) => {
        if (!currentRecoveries[operationProjectKey]) return currentRecoveries

        const nextRecoveries = { ...currentRecoveries }
        delete nextRecoveries[operationProjectKey]
        return nextRecoveries
      })
      setSyncErrorsByProjectKey((currentErrors) => ({
        ...currentErrors,
        [operationProjectKey]: message
      }))
    } finally {
      const remainingSyncProjectKeys = new Set(syncProjectKeysRef.current)
      remainingSyncProjectKeys.delete(operationProjectKey)
      syncProjectKeysRef.current = remainingSyncProjectKeys
      setSyncProjectKeys(remainingSyncProjectKeys)
    }
  }
  const handleSyncChanges = async (action: GitSyncAction): Promise<void> => {
    if (syncDisabled || !changesCwd) return

    await runSyncChanges(action, changesCwd)
  }
  const handleDismissGitSyncRecovery = (): void => {
    setSyncRecoveriesByProjectKey((currentRecoveries) => {
      if (!currentRecoveries[currentProjectKey]) return currentRecoveries

      const nextRecoveries = { ...currentRecoveries }
      delete nextRecoveries[currentProjectKey]
      return nextRecoveries
    })
    setSyncErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[currentProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[currentProjectKey]
      return nextErrors
    })
  }
  const handleGitSyncRecoveryAction = async (
    actionId: AppGitRecoveryActionId,
    options: GitSyncRecoveryActionOptions = {}
  ): Promise<void> => {
    const recovery = visibleSyncRecovery
    if (!recovery || syncInProgress) return

    if (actionId === 'pull-and-push') {
      await runSyncChanges('pullAndPush', recovery.cwd, { recovery })
      return
    }

    if (actionId === 'set-upstream') {
      await runSyncChanges('push', recovery.cwd, { recovery, setUpstream: true })
      return
    }

    if (actionId === 'push-current-branch' || actionId === 'push-upstream-branch') {
      await runSyncChanges('push', recovery.cwd, {
        recovery,
        rememberPushTarget: options.rememberPushTarget,
        pushTarget: actionId === 'push-current-branch' ? 'current-branch' : 'upstream-branch'
      })
      return
    }

    const pullStrategy = getGitRecoveryPullStrategy(actionId)
    if (!pullStrategy) return

    await runSyncChanges(
      recovery.requestedAction === 'pullAndPush' ? 'pullAndPush' : 'pull',
      recovery.cwd,
      { pullStrategy, recovery, rememberStrategy: options.rememberStrategy }
    )
  }
  const handleGitChangeLoadErrorAiResolution = async (permanentFix = false): Promise<void> => {
    const context = visibleGitChangeLoadError
    const promptTemplate = permanentFix
      ? effectiveAppSettings.git.permanentErrorResolutionPrompt
      : effectiveAppSettings.git.errorResolutionPrompt
    if (!context || gitAiResolutionDisabled || !promptTemplate.trim()) return

    await handleSendMessage(
      getGitAiResolutionPrompt(context, promptTemplate),
      undefined,
      [],
      null,
      [],
      [],
      getGitTurnOptions(),
      'new'
    )
  }
  const handleDismissGitChangeLoadError = (): void => {
    setGitChangeLoadErrorDismissed(true)
  }
  const handleDismissGitCommitError = (): void => {
    setCommitErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[currentProjectKey]) return currentErrors
      const nextErrors = { ...currentErrors }
      delete nextErrors[currentProjectKey]
      return nextErrors
    })
  }
  const handleDismissUnclassifiedGitSyncError = (): void => {
    setSyncErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[currentProjectKey]) return currentErrors
      const nextErrors = { ...currentErrors }
      delete nextErrors[currentProjectKey]
      return nextErrors
    })
  }
  const handleGitAiResolution = async (permanentFix = false): Promise<void> => {
    const recovery = visibleSyncRecovery
    const promptTemplate = permanentFix
      ? effectiveAppSettings.git.permanentErrorResolutionPrompt
      : effectiveAppSettings.git.errorResolutionPrompt
    if (!recovery || gitAiResolutionDisabled || !promptTemplate.trim()) return

    setSyncRecoveriesByProjectKey((currentRecoveries) => {
      if (!currentRecoveries[currentProjectKey]) return currentRecoveries

      const nextRecoveries = { ...currentRecoveries }
      delete nextRecoveries[currentProjectKey]
      return nextRecoveries
    })
    setSyncErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[currentProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[currentProjectKey]
      return nextErrors
    })
    await handleSendMessage(
      getGitRecoveryAiResolutionPrompt(recovery, promptTemplate),
      undefined,
      [],
      null,
      [],
      [],
      getGitTurnOptions(),
      'new'
    )
  }
  const handleUnclassifiedGitSyncAiResolution = async (permanentFix = false): Promise<void> => {
    const promptTemplate = permanentFix
      ? effectiveAppSettings.git.permanentErrorResolutionPrompt
      : effectiveAppSettings.git.errorResolutionPrompt
    if (
      !currentProjectSyncError ||
      !changesCwd ||
      gitAiResolutionDisabled ||
      !promptTemplate.trim()
    ) {
      return
    }

    const error = currentProjectSyncError
    setSyncErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[currentProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[currentProjectKey]
      return nextErrors
    })
    await handleSendMessage(
      getGitAiResolutionPrompt(
        {
          cwd: changesCwd,
          error,
          operation: 'Git sync'
        },
        promptTemplate
      ),
      undefined,
      [],
      null,
      [],
      [],
      getGitTurnOptions(),
      'new'
    )
  }
  const handleGitCommitErrorAiResolution = async (permanentFix = false): Promise<void> => {
    const promptTemplate = permanentFix
      ? effectiveAppSettings.git.permanentErrorResolutionPrompt
      : effectiveAppSettings.git.errorResolutionPrompt
    if (
      !currentProjectCommitError ||
      !changesCwd ||
      gitAiResolutionDisabled ||
      !promptTemplate.trim()
    ) {
      return
    }

    const error = currentProjectCommitError
    setCommitErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[currentProjectKey]) return currentErrors

      const nextErrors = { ...currentErrors }
      delete nextErrors[currentProjectKey]
      return nextErrors
    })
    await handleSendMessage(
      getGitAiResolutionPrompt(
        {
          cwd: changesCwd,
          error,
          operation: 'Git commit'
        },
        promptTemplate
      ),
      undefined,
      [],
      null,
      [],
      [],
      getGitTurnOptions(),
      'new'
    )
  }
  const handleGitBranchErrorAiResolution = async (permanentFix = false): Promise<void> => {
    const promptTemplate = permanentFix
      ? effectiveAppSettings.git.permanentErrorResolutionPrompt
      : effectiveAppSettings.git.errorResolutionPrompt
    if (!gitBranchError || !changesCwd || gitAiResolutionDisabled || !promptTemplate.trim()) return

    const error = gitBranchError
    setGitBranchError(null)
    setGitBranchDeleteRetry(null)
    setGitBranchWorktreeDeleteRetry(null)
    if (gitBranchActionState === 'error') setGitBranchActionState('idle')
    await handleSendMessage(
      getGitAiResolutionPrompt(
        {
          cwd: changesCwd,
          error,
          operation: 'Git branch operation'
        },
        promptTemplate
      ),
      undefined,
      [],
      null,
      [],
      [],
      getGitTurnOptions(),
      'new'
    )
  }
  const renderGitAiResolutionButton = (
    onResolve: (permanentFix?: boolean) => Promise<void>,
    placement: 'bottom' | 'top' = 'top'
  ): React.ReactElement => (
    <Button
      title={`Ask ${providerLabels[configProviderId]} to resolve this Git error`}
      disabled={gitAiResolutionDisabled || !effectiveAppSettings.git.errorResolutionPrompt.trim()}
      callback={() => void onResolve()}
      dropdownActions={[
        {
          id: 'ai-permanent-fix',
          label: 'Permanent AI fix',
          title: `Ask ${providerLabels[configProviderId]} to investigate and prefer a safe permanent fix when one exists`,
          disabled:
            gitAiResolutionDisabled ||
            !effectiveAppSettings.git.permanentErrorResolutionPrompt.trim(),
          callback: () => void onResolve(true)
        }
      ]}
      dropdownLabel="AI resolution options"
      dropdownMenuAlign="end"
      dropdownPlacement={placement}
      icon={<Sparkles aria-hidden="true" />}
      label={<span>Resolve with AI</span>}
      theme="secondary"
    />
  )
  const handleSolveUntrackedFiles = async (): Promise<void> => {
    if (!untrackedFilesHiddenForPerformance || untrackedFilesAiDisabled || !changesCwd) return

    await handleSendMessage(
      effectiveAppSettings.git.untrackedFilesPrompt,
      undefined,
      [],
      null,
      [],
      [],
      getGitTurnOptions()
    )
  }

  return {
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
