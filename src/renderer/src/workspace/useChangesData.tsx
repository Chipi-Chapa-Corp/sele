/* eslint-disable react-hooks/exhaustive-deps -- controller refs and state setters are stable inputs */
import { useEffect, useMemo } from 'react'
import type { FileEditorTarget } from '../components/FileEditorDialog'
import {
  filterChangedFilesByPatches,
  getChangedFileDisplayPath,
  getChatChangedFiles,
  getCommitPatches,
  getGitChangedFiles,
  getLastTurnChangedFiles,
  getPatchFilterSignature,
  getRepositoryFiles,
  getTreeFilesWithDisplayPaths,
  isPatchChangeSource,
  isPatchFilterScope,
  type GitChangeSource
} from '../changeTree'
import { type GitSyncAction } from './controllerTypes'
import { isFileTreeScope, isGitChangesScope } from './chatControllerUtils'
import type { ChangesDataDependencies } from './viewModelDependencies'

// Return shape is inferred from the derived change data below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useChangesData(dependencies: ChangesDataDependencies) {
  const {
    changeSource,
    visibleChatItems,
    uncommittedPatchFilter,
    changesContainerKey,
    changesCwd,
    uncommittedPatchFilterError,
    setCachedPatchChangedFiles,
    gitChangesScope,
    gitAvailabilityScopeKey,
    gitChanges,
    fileTreeScope,
    fileTree,
    changesProjectCwd,
    gitChangeLoadScope,
    gitChangeLoadError,
    uncommittedPatchFilterState,
    gitChangeLoadState,
    gitChangeLoadErrorDismissed,
    fileTreeLoadScope,
    fileTreeLoadState,
    cachedPatchChangedFiles,
    changesContainer,
    gitBranchesScope,
    gitBranches,
    changesPaneView,
    selectedChat
  } = dependencies

  const patchChangeSourceSelected = isPatchChangeSource(changeSource)
  const patchSourceChangedFiles = useMemo(() => {
    if (changeSource === 'chat') return getChatChangedFiles(visibleChatItems)
    if (changeSource === 'lastTurn') return getLastTurnChangedFiles(visibleChatItems)

    return []
  }, [changeSource, visibleChatItems])
  const patchSourcePatches = useMemo(
    () => getCommitPatches(patchSourceChangedFiles),
    [patchSourceChangedFiles]
  )
  const patchFilterSignature = useMemo(
    () => getPatchFilterSignature(patchSourcePatches),
    [patchSourcePatches]
  )
  const patchFilterMatches = isPatchFilterScope(
    uncommittedPatchFilter?.scope ?? null,
    changesContainerKey,
    changesCwd,
    changeSource,
    patchFilterSignature
  )
  const patchFilterErrorMatches = isPatchFilterScope(
    uncommittedPatchFilterError?.scope ?? null,
    changesContainerKey,
    changesCwd,
    changeSource,
    patchFilterSignature
  )
  const patchChangedFiles = useMemo(
    () =>
      patchFilterMatches
        ? filterChangedFilesByPatches(
            patchSourceChangedFiles,
            uncommittedPatchFilter?.patches ?? []
          )
        : [],
    [patchFilterMatches, patchSourceChangedFiles, uncommittedPatchFilter?.patches]
  )
  useEffect(() => {
    if (!changesCwd || !isPatchChangeSource(changeSource) || !patchFilterMatches) return

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setCachedPatchChangedFiles({
        containerKey: changesContainerKey,
        cwd: changesCwd,
        source: changeSource,
        files: patchChangedFiles
      })
    })

    return () => {
      active = false
    }
  }, [changeSource, changesContainerKey, changesCwd, patchChangedFiles, patchFilterMatches])
  const currentGitChangeSource: GitChangeSource | null =
    changeSource === 'uncommitted' ? 'uncommitted' : null
  const gitChangesMatchCurrentSource = isGitChangesScope(
    gitChangesScope,
    gitAvailabilityScopeKey,
    changesCwd,
    currentGitChangeSource
  )
  const displayedGitChanges = gitChangesMatchCurrentSource ? gitChanges : null
  const untrackedFilesHiddenForPerformance = Boolean(
    changeSource === 'uncommitted' && displayedGitChanges?.untrackedFilesHiddenForPerformance
  )
  const gitChangedFiles = useMemo(
    () => (changesCwd ? getGitChangedFiles(displayedGitChanges) : []),
    [changesCwd, displayedGitChanges]
  )
  const uncommittedGitChangesMatchCurrentCwd = isGitChangesScope(
    gitChangesScope,
    gitAvailabilityScopeKey,
    changesCwd,
    'uncommitted'
  )
  const uncommittedChangedFiles = useMemo(
    () =>
      changesCwd && uncommittedGitChangesMatchCurrentCwd ? getGitChangedFiles(gitChanges) : [],
    [changesCwd, gitChanges, uncommittedGitChangesMatchCurrentCwd]
  )
  const fileTreeMatchesCurrentCwd = isFileTreeScope(fileTreeScope, changesContainerKey, changesCwd)
  const displayedFileTree = fileTreeMatchesCurrentCwd ? fileTree : null
  const rawRepositoryFiles = useMemo(
    () => (changesCwd ? getRepositoryFiles(displayedFileTree) : []),
    [changesCwd, displayedFileTree]
  )
  const repositoryFilesDisplayRoot =
    displayedFileTree?.repositoryRoot ?? changesProjectCwd ?? changesCwd ?? null
  const repositoryFiles = useMemo(
    () => getTreeFilesWithDisplayPaths(rawRepositoryFiles, repositoryFilesDisplayRoot),
    [rawRepositoryFiles, repositoryFilesDisplayRoot]
  )
  const gitChangeLoadMatchesCurrentSource = isGitChangesScope(
    gitChangeLoadScope,
    gitAvailabilityScopeKey,
    changesCwd,
    currentGitChangeSource
  )
  const gitChangeLoadErrorMatchesCurrentSource = isGitChangesScope(
    gitChangeLoadError?.scope ?? null,
    gitAvailabilityScopeKey,
    changesCwd,
    currentGitChangeSource
  )
  const changesLoadState =
    patchChangeSourceSelected && patchSourcePatches.length > 0
      ? patchFilterMatches || patchFilterErrorMatches
        ? uncommittedPatchFilterState
        : 'loading'
      : patchChangeSourceSelected || !changesCwd
        ? 'ready'
        : gitChangeLoadMatchesCurrentSource
          ? gitChangeLoadState
          : 'loading'
  const visibleGitChangeLoadError =
    changesLoadState !== 'error' || !changesCwd
      ? null
      : patchChangeSourceSelected && patchSourcePatches.length > 0
        ? patchFilterErrorMatches
          ? uncommittedPatchFilterError
          : {
              scope: null,
              cwd: changesCwd,
              error: 'Unable to filter Git changes.',
              operation: 'Filter Git changes'
            }
        : gitChangeLoadErrorMatchesCurrentSource
          ? gitChangeLoadError
          : {
              scope: null,
              cwd: changesCwd,
              error: 'Unable to load changes.',
              operation: 'Load Git changes'
            }
  const displayedGitChangeLoadError = gitChangeLoadErrorDismissed ? null : visibleGitChangeLoadError
  const fileTreeLoadMatchesCurrentCwd = isFileTreeScope(
    fileTreeLoadScope,
    changesContainerKey,
    changesCwd
  )
  const filesLoadState = !changesCwd
    ? 'ready'
    : fileTreeLoadMatchesCurrentCwd
      ? fileTreeLoadState
      : 'loading'
  const visibleFilesLoadState =
    filesLoadState === 'loading' && displayedFileTree ? 'ready' : filesLoadState
  const cachedPatchChangedFilesMatch = Boolean(
    cachedPatchChangedFiles &&
    changesCwd &&
    isPatchChangeSource(changeSource) &&
    cachedPatchChangedFiles.containerKey === changesContainerKey &&
    cachedPatchChangedFiles.cwd === changesCwd &&
    cachedPatchChangedFiles.source === changeSource
  )
  const displayedPatchChangedFiles =
    changesLoadState === 'loading' && cachedPatchChangedFilesMatch
      ? (cachedPatchChangedFiles?.files ?? [])
      : patchChangedFiles
  const preserveDisplayedGitChanges =
    changeSource === 'uncommitted' && displayedGitChanges !== null && changesLoadState !== 'ready'
  const visibleChangesLoadState =
    preserveDisplayedGitChanges ||
    (changesLoadState === 'loading' &&
      patchChangeSourceSelected &&
      displayedPatchChangedFiles.length > 0)
      ? 'ready'
      : changesLoadState
  const rawChangedFiles =
    changeSource === 'chat'
      ? displayedPatchChangedFiles
      : changeSource === 'lastTurn'
        ? displayedPatchChangedFiles
        : gitChangedFiles
  const changedFilesDisplayRoot =
    displayedGitChanges?.repositoryRoot ?? changesProjectCwd ?? changesCwd ?? null
  const changedFiles = useMemo(
    () => getTreeFilesWithDisplayPaths(rawChangedFiles, changedFilesDisplayRoot),
    [changedFilesDisplayRoot, rawChangedFiles]
  )
  const fileEditorDiffTargets = useMemo<FileEditorTarget[]>(
    () =>
      changesCwd
        ? changedFiles.map((file) => ({
            container: changesContainer,
            cwd: changesCwd,
            path: file.path,
            displayPath: getChangedFileDisplayPath(file),
            kind: file.kind,
            previousPath: file.previousPath ?? null
          }))
        : [],
    [changedFiles, changesContainer, changesCwd]
  )
  const gitSyncMetadata = changesCwd && gitChangesScope?.cwd === changesCwd ? gitChanges : null
  const unpulledCount = gitSyncMetadata?.unpulledCount ?? 0
  const unpushedCount = gitSyncMetadata?.unpushedCount ?? 0
  const hasUnpulledChanges = unpulledCount > 0
  const hasUnpushedChanges = unpushedCount > 0
  const hasSyncChanges = hasUnpulledChanges || hasUnpushedChanges
  const primarySyncAction: GitSyncAction =
    hasUnpulledChanges && hasUnpushedChanges ? 'pullAndPush' : hasUnpulledChanges ? 'pull' : 'push'
  const syncButtonTitle = [
    hasUnpulledChanges ? `${unpulledCount} commit${unpulledCount === 1 ? '' : 's'} to pull` : null,
    hasUnpushedChanges ? `${unpushedCount} commit${unpushedCount === 1 ? '' : 's'} to push` : null
  ]
    .filter(Boolean)
    .join(', ')
  const changesGitMetadata = changesCwd && gitChangesScope?.cwd === changesCwd ? gitChanges : null
  const filesMetadata = changesCwd && fileTreeScope?.cwd === changesCwd ? fileTree : null
  const branchMetadata = changesCwd && gitBranchesScope?.cwd === changesCwd ? gitBranches : null
  const currentBranchName =
    branchMetadata?.currentBranch ??
    (changesPaneView === 'files' ? filesMetadata?.branchName : changesGitMetadata?.branchName) ??
    changesGitMetadata?.branchName ??
    selectedChat?.branchName ??
    null
  const branchNames = branchMetadata?.branches ?? (currentBranchName ? [currentBranchName] : [])

  return {
    branchNames,
    changedFiles,
    changesLoadState,
    currentBranchName,
    displayedGitChangeLoadError,
    fileEditorDiffTargets,
    filesLoadState,
    hasSyncChanges,
    hasUnpulledChanges,
    hasUnpushedChanges,
    patchChangeSourceSelected,
    primarySyncAction,
    repositoryFiles,
    syncButtonTitle,
    uncommittedChangedFiles,
    unpulledCount,
    unpushedCount,
    untrackedFilesHiddenForPerformance,
    visibleChangesLoadState,
    visibleFilesLoadState,
    visibleGitChangeLoadError
  }
}
