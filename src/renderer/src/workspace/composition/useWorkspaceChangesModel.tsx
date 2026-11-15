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
  return { changes, newSessionLocationOptions, gitPresentation, files, gitSync, commits, subagents }
}
