import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceDialogState } from '../state/useWorkspaceDialogState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'

export type WorkspaceState = ReturnType<typeof useWorkspaceState>

export function useWorkspaceState() {
  const preferences = useWorkspacePreferenceState()

  const providerState = useWorkspaceProviderState({ preferences })

  const dialogState = useWorkspaceDialogState()

  const chatState = useWorkspaceChatState()

  const sourceState = useWorkspaceSourceState()

  const projectState = useWorkspaceProjectState()

  const searchState = useWorkspaceSearchState()

  const gitState = useWorkspaceGitState()

  const subagentState = useWorkspaceSubagentState()

  const viewportState = useWorkspaceViewportState()
  return {
    preferences,
    providerState,
    dialogState,
    chatState,
    sourceState,
    projectState,
    searchState,
    gitState,
    subagentState,
    viewportState
  }
}
