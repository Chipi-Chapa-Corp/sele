import { useWorkspaceNavigation } from '../features/useWorkspaceNavigation'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSelection } from '../useWorkspaceSelection'

type WorkspaceConversationSearchDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  session: ReturnType<typeof useWorkspaceSelection>
  navigation: ReturnType<typeof useWorkspaceNavigation>
}

export function getWorkspaceConversationSearch({
  chatState,
  searchState,
  session,
  navigation
}: WorkspaceConversationSearchDependencies) {
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
