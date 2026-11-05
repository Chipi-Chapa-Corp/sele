import { useWorkspaceNavigation } from '../features/useWorkspaceNavigation'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

type WorkspaceConversationHeaderDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  navigation: ReturnType<typeof useWorkspaceNavigation>
}

export function getWorkspaceConversationHeader({
  chatState,
  sourceState,
  navigation
}: WorkspaceConversationHeaderDependencies) {
  return {
    visible: Boolean(chatState.selectedChat || sourceState.newChatOpen),
    handleBack: navigation.handleBack
  }
}
