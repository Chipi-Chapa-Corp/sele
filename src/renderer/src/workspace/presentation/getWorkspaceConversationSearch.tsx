import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function getWorkspaceConversationSearch({
  chatState,
  searchState,
  session,
  navigation
}: WorkspaceChanges) {
  return {
    visible: Boolean(chatState.selectedChat && searchState.chatSearchOpen),
    chatSearchActiveIndex: searchState.chatSearchActiveIndex,
    chatSearchInputRef: searchState.chatSearchInputRef,
    chatSearchMatchCount: searchState.chatSearchMatchCount,
    chatSearchQuery: searchState.chatSearchQuery,
    closeChatSearch: session.closeChatSearch,
    handleChatSearchNavigation: navigation.handleChatSearchNavigation,
    setChatSearchQuery: searchState.setChatSearchQuery
  }
}
