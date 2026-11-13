import { useWorkspaceChangesModel } from './workspace/composition/useWorkspaceChangesModel'
import { useWorkspaceChatModel } from './workspace/composition/useWorkspaceChatModel'
import { useWorkspacePresentation } from './workspace/composition/useWorkspacePresentation'
import { useWorkspaceRuntime } from './workspace/composition/useWorkspaceRuntime'
import { useWorkspaceState } from './workspace/composition/useWorkspaceState'
import { useLatestHandler } from './workspace/stableProps'
import { useWorkspaceSelection } from './workspace/useWorkspaceSelection'

// The return type intentionally stays inferred so every view slice remains exact.
export const useWorkspaceController = ({
  onConversationRequested
}: {
  onConversationRequested?: () => void
} = {}) => {
  const state = useWorkspaceState()
  const runtime = useWorkspaceRuntime({ state })

  const session = useWorkspaceSelection({ ...state, ...runtime })
  // Navigation can request subagent actions after render; the handlers use the latest workspace.
  const returnToRootChat = useLatestHandler(() => changesModel.subagents.handleReturnToRootChat())
  const returnFromSubagentChat = useLatestHandler(() =>
    changesModel.subagents.handleReturnFromSubagentChat()
  )
  const chatModel = useWorkspaceChatModel({
    state,
    runtime,
    session,
    onConversationRequested,
    returnToRootChat,
    returnFromSubagentChat
  })
  const changesModel = useWorkspaceChangesModel({ runtime, chatModel, state, session })

  return useWorkspacePresentation({ state, session, chatModel, changesModel, runtime })
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>
