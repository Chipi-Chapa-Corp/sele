import { useWorkspacePanes } from '../features/useWorkspacePanes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useChangesData } from '../useChangesData'
import { useWorkspaceConversation } from './useWorkspaceConversation'
import { useWorkspaceSession } from './useWorkspaceSession'

type WorkspaceChangesDependencies = {
  panes: ReturnType<typeof useWorkspacePanes>
  conversation: ReturnType<typeof useWorkspaceConversation>
  gitState: ReturnType<typeof useWorkspaceGitState>
  session: ReturnType<typeof useWorkspaceSession>
  chatState: ReturnType<typeof useWorkspaceChatState>
}

export function useWorkspaceChanges({
  panes,
  conversation,
  gitState,
  session,
  chatState
}: WorkspaceChangesDependencies) {
  const {
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
  } = useChangesData({
    changeSource: panes.changeSource,
    visibleChatItems: conversation.visibleChatItems,
    uncommittedPatchFilter: gitState.uncommittedPatchFilter,
    changesContainerKey: session.changesContainerKey,
    changesCwd: session.changesCwd,
    uncommittedPatchFilterError: gitState.uncommittedPatchFilterError,
    setCachedPatchChangedFiles: gitState.setCachedPatchChangedFiles,
    gitChangesScope: gitState.gitChangesScope,
    gitAvailabilityScopeKey: session.gitAvailabilityScopeKey,
    gitChanges: gitState.gitChanges,
    fileTreeScope: gitState.fileTreeScope,
    fileTree: gitState.fileTree,
    changesProjectCwd: session.changesProjectCwd,
    gitChangeLoadScope: gitState.gitChangeLoadScope,
    gitChangeLoadError: gitState.gitChangeLoadError,
    uncommittedPatchFilterState: gitState.uncommittedPatchFilterState,
    gitChangeLoadState: gitState.gitChangeLoadState,
    gitChangeLoadErrorDismissed: gitState.gitChangeLoadErrorDismissed,
    fileTreeLoadScope: gitState.fileTreeLoadScope,
    fileTreeLoadState: gitState.fileTreeLoadState,
    cachedPatchChangedFiles: gitState.cachedPatchChangedFiles,
    changesContainer: session.changesContainer,
    gitBranchesScope: gitState.gitBranchesScope,
    gitBranches: gitState.gitBranches,
    changesPaneView: panes.changesPaneView,
    selectedChat: chatState.selectedChat
  })
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
