import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function getWorkspaceConversationHeader({
  chatState,
  sourceState,
  navigation
}: WorkspaceChanges) {
  return {
    visible: Boolean(chatState.selectedChat || sourceState.newChatOpen),
    handleBack: navigation.handleBack
  }
}
