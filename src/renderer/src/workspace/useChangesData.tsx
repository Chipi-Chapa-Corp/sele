// biome-ignore-all lint/correctness/useExhaustiveDependencies: controller refs and state setters are stable inputs
import { useMemo } from 'react'
import type { FileEditorTarget } from '../components/FileEditorDialog'
import {
  getChangedFileDisplayPath,
  getGitChangedFiles,
  getTreeFilesWithDisplayPaths
} from '../changeTree'
import { type GitSyncAction } from './controllerTypes'
import { isFileTreeScope, isGitChangesScope } from './chatControllerUtils'
import type { useWorkspacePanes } from './features/useWorkspacePanes'
import type { useWorkspaceChatState } from './state/useWorkspaceChatState'
import type { useWorkspaceGitState } from './state/useWorkspaceGitState'
import type { useWorkspaceSelection } from './useWorkspaceSelection'

// Return shape is inferred from the derived change data below.
export function useChangesData({
  panes,
  gitState,
  session,
  chatState
}: {
  panes: ReturnType<typeof useWorkspacePanes>
  gitState: ReturnType<typeof useWorkspaceGitState>
  session: ReturnType<typeof useWorkspaceSelection>
  chatState: ReturnType<typeof useWorkspaceChatState>
}) {
  const { changesPaneView } = panes
  const {
    gitChangesScope,
    gitChanges,
    fileTreeScope,
    fileTree,
    gitChangeLoadScope,
    gitChangeLoadError,
    gitChangeLoadState,
    gitChangeLoadErrorDismissed,
    fileTreeLoadScope,
    fileTreeLoadState,
    gitBranchesScope,
    gitBranches
  } = gitState
  const {
    changesContainerKey,
    changesCwd,
    gitAvailabilityScopeKey,
    changesProjectCwd,
    changesContainer
  } = session
  const { selectedChat } = chatState

  const displayedGitChanges = isGitChangesScope(
    gitChangesScope,
    gitAvailabilityScopeKey,
    changesCwd
  )
    ? gitChanges
    : null
  const untrackedFilesHiddenForPerformance = Boolean(
    displayedGitChanges?.untrackedFilesHiddenForPerformance
  )
  const uncommittedChangedFiles = useMemo(
    () => (changesCwd ? getGitChangedFiles(displayedGitChanges) : []),
    [changesCwd, displayedGitChanges]
  )
  const fileTreeMatchesCurrentCwd = isFileTreeScope(fileTreeScope, changesContainerKey, changesCwd)
  const repositoryFileIndex = fileTreeMatchesCurrentCwd && changesCwd ? fileTree : null
  const repositoryFileCount = repositoryFileIndex?.fileCount ?? 0
  const changesLoadState = !changesCwd
    ? 'ready'
    : isGitChangesScope(gitChangeLoadScope, gitAvailabilityScopeKey, changesCwd)
      ? gitChangeLoadState
      : 'loading'
  const gitChangeLoadErrorMatchesCurrentCwd = isGitChangesScope(
    gitChangeLoadError?.scope ?? null,
    gitAvailabilityScopeKey,
    changesCwd
  )
  const visibleGitChangeLoadError =
    changesCwd &&
    gitChangeLoadError?.operation === 'Fetch Git remote' &&
    gitChangeLoadErrorMatchesCurrentCwd
      ? gitChangeLoadError
      : changesLoadState !== 'error' || !changesCwd
        ? null
        : gitChangeLoadErrorMatchesCurrentCwd
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
    filesLoadState === 'loading' && repositoryFileIndex ? 'ready' : filesLoadState
  const visibleChangesLoadState =
    displayedGitChanges !== null && changesLoadState !== 'ready' ? 'ready' : changesLoadState
  const changedFilesDisplayRoot =
    displayedGitChanges?.repositoryRoot ?? changesProjectCwd ?? changesCwd ?? null
  const changedFiles = useMemo(
    () => getTreeFilesWithDisplayPaths(uncommittedChangedFiles, changedFilesDisplayRoot),
    [changedFilesDisplayRoot, uncommittedChangedFiles]
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
  const filesMetadata = changesCwd && fileTreeScope?.cwd === changesCwd ? fileTree : null
  const branchMetadata = changesCwd && gitBranchesScope?.cwd === changesCwd ? gitBranches : null
  const currentBranchName =
    branchMetadata?.currentBranch ??
    (changesPaneView === 'files' ? filesMetadata?.branchName : gitSyncMetadata?.branchName) ??
    gitSyncMetadata?.branchName ??
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
    primarySyncAction,
    repositoryFileCount,
    repositoryFileIndex,
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
