import { FolderKanban, GitBranch } from 'lucide-react'
import { useMemo } from 'react'
import type { DropdownOption } from '../../components/Dropdown'
import { type NewSessionLocation } from '../controllerTypes'
import { useWorkspaceChanges } from '../wiring/useWorkspaceChanges'
import { useWorkspaceCommits } from '../wiring/useWorkspaceCommits'
import { useWorkspaceFiles } from '../wiring/useWorkspaceFiles'
import { useWorkspaceGitPresentation } from '../wiring/useWorkspaceGitPresentation'
import { useWorkspaceGitSync } from '../wiring/useWorkspaceGitSync'
import { useWorkspaceSession } from '../wiring/useWorkspaceSession'
import { useWorkspaceSubagents } from '../wiring/useWorkspaceSubagents'
import { useWorkspaceChatModel } from './useWorkspaceChatModel'
import { useWorkspaceRuntime } from './useWorkspaceRuntime'
import { useWorkspaceState } from './useWorkspaceState'

type WorkspaceChangesModelDependencies = {
  runtime: ReturnType<typeof useWorkspaceRuntime>
  chatModel: ReturnType<typeof useWorkspaceChatModel>
  state: ReturnType<typeof useWorkspaceState>
  session: ReturnType<typeof useWorkspaceSession>
}

export function useWorkspaceChangesModel({
  runtime,
  chatModel,
  state,
  session
}: WorkspaceChangesModelDependencies) {
  const changes = useWorkspaceChanges({
    panes: runtime.panes,
    conversation: chatModel.conversation,
    gitState: state.gitState,
    session,
    chatState: state.chatState
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

  const gitPresentation = useWorkspaceGitPresentation({
    gitState: state.gitState,
    settings: runtime.settings,
    session,
    chatState: state.chatState,
    interactions: chatModel.interactions,
    changes,
    providerUpdates: runtime.providerUpdates,
    handleSyncChanges: (action) => gitSync.handleSyncChanges(action),
    sourceState: state.sourceState,
    panes: runtime.panes
  })

  const files = useWorkspaceFiles({
    gitState: state.gitState,
    session,
    changes,
    gitPresentation,
    panes: runtime.panes,
    dialogState: state.dialogState,
    chatState: state.chatState,
    viewportState: state.viewportState,
    scroll: runtime.scroll
  })

  const gitSync = useWorkspaceGitSync({
    gitState: state.gitState,
    session,
    gitPresentation,
    changes,
    settings: runtime.settings,
    messaging: chatModel.messaging,
    provider: runtime.provider
  })

  const commits = useWorkspaceCommits({
    gitState: state.gitState,
    providerUpdates: runtime.providerUpdates,
    chatState: state.chatState,
    session,
    sourceState: state.sourceState,
    gitPresentation,
    messaging: chatModel.messaging,
    viewportState: state.viewportState,
    chatProjection: runtime.chatProjection,
    settings: runtime.settings,
    changes,
    gitSync,
    chatRead: runtime.chatRead,
    searchState: state.searchState,
    subagentState: state.subagentState,
    navigation: chatModel.navigation
  })

  const subagents = useWorkspaceSubagents({
    viewportState: state.viewportState,
    chatRead: runtime.chatRead,
    session,
    subagentState: state.subagentState,
    searchState: state.searchState,
    chatState: state.chatState,
    scroll: runtime.scroll,
    gitState: state.gitState,
    commits
  })
  return { changes, newSessionLocationOptions, gitPresentation, files, gitSync, commits, subagents }
}
