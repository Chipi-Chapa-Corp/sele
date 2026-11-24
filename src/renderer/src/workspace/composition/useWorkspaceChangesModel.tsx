import { FolderKanban, GitBranch } from 'lucide-react'
import { useMemo } from 'react'
import type { DropdownOption } from '../../components/Dropdown'
import { type NewSessionLocation } from '../controllerTypes'
import { useChangesData } from '../useChangesData'
import { useCommitController } from '../useCommitController'
import { useFileNavigationController } from '../useFileNavigationController'
import { useGitViewModel } from '../useGitViewModel'
import { useGitSyncController } from '../useGitSyncController'
import { useWorkspaceSelection } from '../useWorkspaceSelection'
import { useSubagentController } from '../useSubagentController'
import { useBenchmarkWorktreeChanges } from '../features/useBenchmarkWorktreeChanges'
import { useBenchmarkWorktreeFiles } from '../features/useBenchmarkWorktreeFiles'
import { useWorkspaceChatModel, type WorkspaceChat } from './useWorkspaceChatModel'
import { useWorkspaceRuntime } from './useWorkspaceRuntime'
import { useWorkspaceState } from './useWorkspaceState'

type WorkspaceChangesModelDependencies = {
  runtime: ReturnType<typeof useWorkspaceRuntime>
  chatModel: ReturnType<typeof useWorkspaceChatModel>
  state: ReturnType<typeof useWorkspaceState>
  session: ReturnType<typeof useWorkspaceSelection>
}

export type WorkspaceChanges = WorkspaceChat & ReturnType<typeof useWorkspaceChangesModel>

export function useWorkspaceChangesModel({
  runtime,
  chatModel,
  state,
  session
}: WorkspaceChangesModelDependencies) {
  const workspace = { ...state, ...runtime, ...chatModel, session }

  const changes = useChangesData(workspace)
  const worktrees = chatModel.benchmark.worktrees
  // Ending a benchmark can remove a worktree before the chat update reaches the sidebar.
  const canReadWorktrees = !chatModel.benchmark.busy
  const primaryUsesWorkspace = Boolean(
    worktrees?.primary.cwd && worktrees.primary.cwd === session.changesCwd
  )
  const worktreeChangesOptions = {
    container: session.changesContainer,
    refresh: state.gitState.gitChangeLoadRequest,
    visible:
      canReadWorktrees &&
      runtime.panes.changesPaneView === 'git' &&
      runtime.panes.gitPaneView === 'changes'
  }
  const primaryWorktreeChanges = useBenchmarkWorktreeChanges({
    ...worktreeChangesOptions,
    source: worktrees?.primary ?? null,
    workspaceChanges: primaryUsesWorkspace ? changes : undefined
  })
  const secondaryWorktreeChanges = useBenchmarkWorktreeChanges({
    ...worktreeChangesOptions,
    source: worktrees?.secondary ?? null
  })
  const worktreeFilesOptions = {
    container: session.changesContainer,
    refresh: state.gitState.fileTreeLoadRequest,
    visible: canReadWorktrees && runtime.panes.changesPaneView === 'files'
  }
  const primaryWorktreeFiles = useBenchmarkWorktreeFiles({
    ...worktreeFilesOptions,
    source: worktrees?.primary ?? null,
    workspaceFiles: primaryUsesWorkspace
      ? {
          result: changes.repositoryFileIndex,
          branchName: changes.currentBranchName,
          loading: changes.visibleFilesLoadState === 'loading',
          error: changes.filesLoadState === 'error' ? state.gitState.fileTreeLoadError : null
        }
      : undefined
  })
  const secondaryWorktreeFiles = useBenchmarkWorktreeFiles({
    ...worktreeFilesOptions,
    source: worktrees?.secondary ?? null
  })

  const newSessionLocationOptions = useMemo<DropdownOption<NewSessionLocation>[]>(
    () => [
      {
        value: 'folder',
        label: 'Folder',
        icon: <FolderKanban aria-hidden="true" />
      },
      {
        value: 'worktree',
        label: 'Worktree',
        menuLabel: changes.currentBranchName
          ? `Worktree · ${changes.currentBranchName}`
          : 'Worktree',
        icon: <GitBranch aria-hidden="true" />
      }
    ],
    [changes.currentBranchName]
  )

  const gitPresentation = useGitViewModel({
    ...workspace,
    changes,
    handleSyncChanges: (action) => gitSync.handleSyncChanges(action)
  })

  const files = useFileNavigationController({ ...workspace, changes, gitPresentation })

  const gitSync = useGitSyncController({ ...workspace, gitPresentation, changes })

  const commits = useCommitController({ ...workspace, gitPresentation, gitSync })

  const subagents = useSubagentController({ ...workspace, commits })
  return {
    changes,
    primaryWorktreeChanges,
    secondaryWorktreeChanges,
    primaryWorktreeFiles,
    secondaryWorktreeFiles,
    newSessionLocationOptions,
    gitPresentation,
    files,
    gitSync,
    commits,
    subagents
  }
}
