// biome-ignore-all lint/correctness/useExhaustiveDependencies: controller refs and state setters are stable inputs
import { type CSSProperties, useCallback, useEffect, useMemo } from 'react'
import { Download, Upload } from 'lucide-react'
import { isChatCommitProjectLocked } from '../chatCommitPolicy'
import { type ButtonDropdownAction } from '../components/Button'
import { SegmentedControl } from '../components/SegmentedControl'
import { buildChangeTree, getTreeFolderPaths } from '../changeTree'
import { getFileTreeIndexNodes, getVisibleFileTreeFolderPaths } from '../fileTreeIndex'
import {
  gitCommitModeOptions,
  type GitCommitMode,
  type GitCommitPromptAction
} from './controllerTypes'
import { getFileTreeEmptyMessage } from './gitControllerUtils'
import { getChangesEmptyMessage, getChatCwdGroupKey } from './chatControllerUtils'
import type { GitViewModelDependencies } from './controllerDependencies'

// Return shape is inferred from the view-model declarations below.
export function useGitViewModel(dependencies: GitViewModelDependencies) {
  const {
    commitInput,
    effectiveAppSettings,
    gitCommitMode,
    changesProjectCwd,
    changesCwd,
    visibleGitErrorProjectKeyRef,
    setCommitErrorsByProjectKey,
    setSyncErrorsByProjectKey,
    setSyncRecoveriesByProjectKey,
    syncProjectKeys,
    syncErrorsByProjectKey,
    syncRecoveriesByProjectKey,
    commitMessageGenerationProjectKeys,
    commitErrorsByProjectKey,
    scopedCommitActivities,
    directCommitActivities,
    startingScopedCommitActivities,
    sendState,
    sendInFlightProjectKey,
    editingMessage,
    selectedChat,
    chatDetail,
    chatLoadState,
    chatIsBusy,
    changedFiles,
    untrackedFilesHiddenForPerformance,
    providerUpdateInProgress,
    changesLoadState,
    uncommittedChangedFiles,
    gitAvailableForCurrentSource,
    setGitCommitMode,
    gitBranchActionState,
    hasUnpulledChanges,
    unpulledCount,
    handleSyncChanges,
    hasUnpushedChanges,
    unpushedCount,
    chatHasActiveTurn,
    newSessionProviderAvailable,
    changeSource,
    repositoryFileIndex,
    changesPaneView,
    collapsedFileTreeFolders,
    collapsedChangeTreeFolders,
    filesLoadState
  } = dependencies

  const commitInputValue = commitInput.trim()
  const { showManualCommit, showAiInstructionsInput } = effectiveAppSettings.git.quickActions
  const showCommitInput = showManualCommit || showAiInstructionsInput
  const aiCommitInstructions = showAiInstructionsInput ? commitInputValue : ''
  const pushAfterCommit = gitCommitMode === 'push'
  const currentProjectKey = getChatCwdGroupKey(changesProjectCwd ?? changesCwd)
  useEffect(() => {
    const previousProjectKey = visibleGitErrorProjectKeyRef.current
    visibleGitErrorProjectKeyRef.current = currentProjectKey
    if (!previousProjectKey || previousProjectKey === currentProjectKey) return
    // Setting unchanged state still rerenders the workspace during a chat switch.
    if (
      !commitErrorsByProjectKey[previousProjectKey] &&
      !syncErrorsByProjectKey[previousProjectKey] &&
      !syncRecoveriesByProjectKey[previousProjectKey]
    ) {
      return
    }

    setCommitErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[previousProjectKey]) return currentErrors
      const nextErrors = { ...currentErrors }
      delete nextErrors[previousProjectKey]
      return nextErrors
    })
    setSyncErrorsByProjectKey((currentErrors) => {
      if (!currentErrors[previousProjectKey]) return currentErrors
      const nextErrors = { ...currentErrors }
      delete nextErrors[previousProjectKey]
      return nextErrors
    })
    setSyncRecoveriesByProjectKey((currentRecoveries) => {
      if (!currentRecoveries[previousProjectKey]) return currentRecoveries
      const nextRecoveries = { ...currentRecoveries }
      delete nextRecoveries[previousProjectKey]
      return nextRecoveries
    })
  }, [currentProjectKey])
  const syncInProgress = syncProjectKeys.has(currentProjectKey)
  const currentProjectSyncError = syncErrorsByProjectKey[currentProjectKey] ?? null
  const projectSyncRecovery = syncRecoveriesByProjectKey[currentProjectKey] ?? null
  const visibleSyncRecovery = projectSyncRecovery?.cwd === changesCwd ? projectSyncRecovery : null
  const visibleSyncRecoveryActions = visibleSyncRecovery
    ? visibleSyncRecovery.failure.kind === 'pull-diverged' ||
      visibleSyncRecovery.failure.kind === 'push-upstream-mismatch'
      ? visibleSyncRecovery.failure.actions.slice(0, 1)
      : visibleSyncRecovery.failure.actions
    : []
  const commitMessageGenerationInProgress =
    commitMessageGenerationProjectKeys.has(currentProjectKey)
  const currentProjectCommitError = commitErrorsByProjectKey[currentProjectKey] ?? null
  const currentProjectCommitActivities = useMemo(() => {
    return [...Object.values(scopedCommitActivities), ...Object.values(directCommitActivities)]
      .filter((activity) => getChatCwdGroupKey(activity.projectCwd) === currentProjectKey)
      .sort((firstActivity, secondActivity) => firstActivity.startedAt - secondActivity.startedAt)
  }, [currentProjectKey, directCommitActivities, scopedCommitActivities])
  const currentProjectAiCommitStarting = Boolean(startingScopedCommitActivities[currentProjectKey])
  const projectCommitInProgress = isChatCommitProjectLocked(
    currentProjectCommitActivities.length,
    currentProjectAiCommitStarting
  )
  const directProjectCommitInProgress = currentProjectCommitActivities.some(
    (activity) => activity.source === 'git'
  )
  const currentProjectSendInProgress =
    sendState === 'sending' && sendInFlightProjectKey === currentProjectKey
  const currentProjectSyncInProgress = syncInProgress
  const aiCommitUnavailable =
    currentProjectSendInProgress ||
    Boolean(editingMessage) ||
    (selectedChat ? !chatDetail || chatLoadState !== 'ready' || chatIsBusy : false)
  const hasDirectCommitChanges = changedFiles.length > 0 || untrackedFilesHiddenForPerformance
  const commitBaseDisabled =
    !hasDirectCommitChanges ||
    changesLoadState !== 'ready' ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress ||
    currentProjectSyncInProgress
  const getCommitActionDisabled = (
    action: GitCommitPromptAction,
    message = commitInputValue
  ): boolean => commitBaseDisabled || !changesCwd || (action === 'commit' && !message)
  const commitDisabled = getCommitActionDisabled('commit')
  const aiCommitBaseDisabled =
    providerUpdateInProgress ||
    !changesCwd ||
    uncommittedChangedFiles.length === 0 ||
    changesLoadState !== 'ready' ||
    projectCommitInProgress ||
    commitMessageGenerationInProgress ||
    currentProjectSyncInProgress ||
    aiCommitUnavailable
  // Memoized render-time props let the changes footer skip unrelated renders.
  const getAiCommitActionDisabled = useCallback(
    (): boolean => aiCommitBaseDisabled,
    [aiCommitBaseDisabled]
  )
  const commitMessageGenerationDisabled =
    providerUpdateInProgress ||
    !changesCwd ||
    uncommittedChangedFiles.length === 0 ||
    changesLoadState !== 'ready' ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress ||
    currentProjectSyncInProgress
  const commitInputLabel = showManualCommit
    ? showAiInstructionsInput
      ? 'Commit message or AI instructions'
      : 'Commit message'
    : 'AI instructions'
  const syncDisabled =
    !changesCwd ||
    gitAvailableForCurrentSource === false ||
    syncInProgress ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress
  const gitCommitModeDisabled =
    commitMessageGenerationInProgress || projectCommitInProgress || currentProjectSyncInProgress
  const gitCommitModeToggle = useMemo(
    () => (
      <SegmentedControl<GitCommitMode>
        aria-label="Commit completion mode"
        className="changes-sidebar__commit-mode"
        disabled={gitCommitModeDisabled}
        options={gitCommitModeOptions}
        value={gitCommitMode}
        onChange={setGitCommitMode}
      />
    ),
    [gitCommitMode, gitCommitModeDisabled]
  )
  const branchSwitchDisabled =
    !changesCwd ||
    gitAvailableForCurrentSource === false ||
    gitBranchActionState === 'sending' ||
    currentProjectSyncInProgress ||
    commitMessageGenerationInProgress ||
    projectCommitInProgress ||
    chatIsBusy
  const syncDropdownActions: ButtonDropdownAction[] = [
    ...(hasUnpulledChanges
      ? [
          {
            id: 'pull',
            label: `Pull ${unpulledCount}`,
            disabled: syncDisabled,
            callback: () => void handleSyncChanges('pull'),
            icon: <Download aria-hidden="true" />
          }
        ]
      : []),
    ...(hasUnpushedChanges
      ? [
          {
            id: 'push',
            label: `Push ${unpushedCount}`,
            disabled: syncDisabled,
            callback: () => void handleSyncChanges('push'),
            icon: <Upload aria-hidden="true" />
          }
        ]
      : [])
  ]
  const gitAiResolutionDisabled =
    providerUpdateInProgress ||
    syncInProgress ||
    sendState === 'sending' ||
    Boolean(editingMessage) ||
    (selectedChat ? chatLoadState !== 'ready' || chatIsBusy : false)
  const untrackedFilesAiDisabled =
    providerUpdateInProgress ||
    syncInProgress ||
    sendState === 'sending' ||
    Boolean(editingMessage) ||
    !changesCwd ||
    !effectiveAppSettings.git.untrackedFilesPrompt.trim() ||
    (selectedChat
      ? !chatDetail ||
        chatLoadState !== 'ready' ||
        (chatHasActiveTurn && !chatDetail.capabilities.activeMessages)
      : !newSessionProviderAvailable)
  const changesEmptyMessage = getChangesEmptyMessage(changeSource, changesCwd)
  const filesEmptyMessage = getFileTreeEmptyMessage(changesCwd)
  const changeTree = useMemo(() => buildChangeTree(changedFiles), [changedFiles])
  const repositoryFileTree = useMemo(
    () => (repositoryFileIndex ? getFileTreeIndexNodes(repositoryFileIndex, '') : []),
    [repositoryFileIndex]
  )
  const changeTreeFolderPaths = useMemo(() => getTreeFolderPaths(changeTree), [changeTree])
  // Only rendered folders: the index may hold thousands that are never shown.
  const repositoryFileTreeFolderPaths = useMemo(
    () =>
      repositoryFileIndex
        ? getVisibleFileTreeFolderPaths(repositoryFileIndex, collapsedFileTreeFolders)
        : [],
    [collapsedFileTreeFolders, repositoryFileIndex]
  )
  const activeTreeFolderPaths =
    changesPaneView === 'files' ? repositoryFileTreeFolderPaths : changeTreeFolderPaths
  const activeCollapsedTreeFolders =
    changesPaneView === 'files' ? collapsedFileTreeFolders : collapsedChangeTreeFolders
  // Explicitly collapsed folders only: "Expand all" opens one level of the file tree, not
  // every nested folder that starts collapsed.
  const hasCollapsedActiveTreeFolders = activeTreeFolderPaths.some(
    (folderPath) => activeCollapsedTreeFolders[folderPath]
  )
  const treeToggleLabel = hasCollapsedActiveTreeFolders ? 'Expand all' : 'Collapse all'
  const activeSidebarLoadState = changesPaneView === 'files' ? filesLoadState : changesLoadState
  const refreshSidebarLabel = changesPaneView === 'files' ? 'Refresh files' : 'Refresh changes'
  const getChangeTreeRowStyle = (depth: number): CSSProperties =>
    ({ '--change-tree-depth': depth }) as CSSProperties

  return {
    activeSidebarLoadState,
    activeTreeFolderPaths,
    aiCommitInstructions,
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
