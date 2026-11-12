import { startTransition, useCallback, useRef } from 'react'
import type { ProviderChat } from '../../../../shared/provider'
import { prefetchChatOpening } from '../../chatOpening'
import { readChatScrollAnchor } from '../../chatLayout'
import { scrollChatSearchMatchIntoView, setChatSearchHighlights } from '../../chatSearch'
import { type ChatListGroupData } from '../../components/ChatListGroup'
import type { LinkedChatReference } from '../../linkedChats'
import { providerApi } from '../../providerApi'
import { getChatFromDetail, getChatKey, getChatProjectCwd } from '../chatControllerUtils'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceSubagentState } from '../state/useWorkspaceSubagentState'
import { useWorkspaceViewportState } from '../state/useWorkspaceViewportState'
import { useWorkspaceChatCache } from './useWorkspaceChatCache'
import { useWorkspaceChatProjection } from './useWorkspaceChatProjection'
import { useWorkspaceChatReadState } from './useWorkspaceChatReadState'

import type { useWorkspaceSelection } from '../useWorkspaceSelection'
type WorkspaceNavigationDependencies = {
  onConversationRequested: (() => void) | undefined
  chatState: ReturnType<typeof useWorkspaceChatState>
  handleReturnToRootChat: () => void
  chatCache: ReturnType<typeof useWorkspaceChatCache>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  gitState: ReturnType<typeof useWorkspaceGitState>
  subagentState: ReturnType<typeof useWorkspaceSubagentState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  chatRead: ReturnType<typeof useWorkspaceChatReadState>
  handleReturnFromSubagentChat: () => void
  chatProjection: ReturnType<typeof useWorkspaceChatProjection>
  viewportState: ReturnType<typeof useWorkspaceViewportState>
  session: Pick<ReturnType<typeof useWorkspaceSelection>, 'activeSubagentChatView'>
}

export function useWorkspaceNavigation({
  onConversationRequested,
  chatState,
  handleReturnToRootChat,
  chatCache,
  searchState,
  gitState,
  subagentState,
  sourceState,
  chatRead,
  handleReturnFromSubagentChat,
  chatProjection,
  viewportState,
  session
}: WorkspaceNavigationDependencies) {
  const { activeSubagentChatView } = session

  const handleSelectChat = (chat: ProviderChat): void => {
    prefetchChatOpening(chat, false)
    startTransition(() => {
      onConversationRequested?.()
      chatState.setManuallyUnreadChatKeys((current) => {
        const key = getChatKey(chat)
        if (!current.has(key)) return current
        const next = new Set(current)
        next.delete(key)
        return next
      })
      const selectingCurrentChat =
        chatState.selectedChatKeyRef.current === getChatKey(chat) &&
        chatState.selectedChat?.providerId === chat.providerId &&
        chatState.selectedChat.id === chat.id
      if (selectingCurrentChat && activeSubagentChatView) {
        handleReturnToRootChat()
        return
      }
      const seenUpdatedAt = chat.updatedAt
      const cachedDetail = chatCache.getRecentCachedChatDetail(chat)
      const seenChat = {
        ...chat,
        seenUpdatedAt:
          chat.seenUpdatedAt == null ? seenUpdatedAt : Math.max(chat.seenUpdatedAt, seenUpdatedAt)
      }
      const nextCachedDetail = cachedDetail
        ? {
            ...cachedDetail,
            seenUpdatedAt:
              cachedDetail.seenUpdatedAt == null
                ? seenUpdatedAt
                : Math.max(cachedDetail.seenUpdatedAt, seenUpdatedAt)
          }
        : null

      searchState.resetChatSearch()
      gitState.setCommitChatReturnTarget(null)
      subagentState.subagentChatLoadRequestRef.current += 1
      subagentState.setSubagentChatView(null)
      chatState.setSendState(chatState.sendInFlightRef.current ? 'sending' : 'idle')
      chatState.setEditingMessage(null)
      sourceState.setNewChatOpen(false)
      searchState.setSearchOpen(false)
      searchState.setSearchQuery('')

      // Even a click on the currently painted chat is a selection request: a
      // different transition may still be pending behind that visible view.
      // Publishing this request cancels the intermediate destination.
      chatRead.markSelectedChatSeen()
      chatState.selectedChatKeyRef.current = getChatKey(chat)
      chatState.selectedChatUpdatedAtRef.current = chat.updatedAt
      chatState.chatDetailRef.current = nextCachedDetail
      chatState.selectChatView(seenChat, nextCachedDetail)
      // Selection and already prepared messages commit together. Provider refreshes
      // run independently; they never put a loader in front of readable history.
      chatState.setChatLoadState(nextCachedDetail ? 'ready' : 'loading')
      chatRead.markChatSeenAt(chat.providerId, chat.id, seenUpdatedAt)

      if (selectingCurrentChat && !cachedDetail) {
        chatState.setChatLoadRequest((currentRequest) => currentRequest + 1)
      }
    })
  }

  const handleOpenLinkedChat = (reference: LinkedChatReference): void => {
    const listedChat = chatState.chatsRef.current.find(
      (chat) => chat.providerId === reference.providerId && chat.id === reference.chatId
    )
    if (listedChat) {
      handleSelectChat(listedChat)
      return
    }
    // Done and unloaded project chats are not in the sidebar list yet.
    void providerApi
      .getChat(reference.providerId, reference.chatId)
      .then((detail) =>
        handleSelectChat(
          getChatFromDetail(reference.providerId, detail, null, detail.updatedAt ?? Date.now())
        )
      )
      .catch((error: unknown) => {
        console.error('Unable to open the linked chat.', error)
      })
  }

  const openLinkedChatRef = useRef(handleOpenLinkedChat)

  openLinkedChatRef.current = handleOpenLinkedChat

  // Stable for the context consumers in memoized panels.
  const openLinkedChat = useCallback(
    (reference: LinkedChatReference) => openLinkedChatRef.current(reference),
    []
  )

  const handleBack = (): void =>
    startTransition(() => {
      if (activeSubagentChatView) {
        handleReturnFromSubagentChat()
        return
      }

      chatRead.markSelectedChatSeen()
      gitState.setCommitChatReturnTarget(null)
      subagentState.subagentChatLoadRequestRef.current += 1
      subagentState.setSubagentChatView(null)
      chatState.selectedChatKeyRef.current = null
      chatState.selectedChatUpdatedAtRef.current = null
      searchState.resetChatSearch()
      chatState.chatDetailRef.current = null
      chatState.setSelectedChat(null)
      chatState.setChatDetail(null)
      sourceState.setNewChatOpen(false)
      chatState.setSendState(chatState.sendInFlightRef.current ? 'sending' : 'idle')
      chatState.setEditingMessage(null)
    })

  const handleNewChat = (): void =>
    startTransition(() => {
      onConversationRequested?.()
      const currentChat = chatState.selectedChat
        ? chatState.chatDetail?.id === chatState.selectedChat.id
          ? chatState.chatDetail
          : chatState.selectedChat
        : null
      const projectCwd =
        currentChat && !currentChat.imported ? getChatProjectCwd(currentChat) : undefined
      const projectContainer = currentChat?.container ?? undefined
      chatRead.markSelectedChatSeen()
      chatState.selectedChatKeyRef.current = null
      chatState.selectedChatUpdatedAtRef.current = null
      subagentState.subagentChatLoadRequestRef.current += 1
      subagentState.setSubagentChatView(null)
      chatProjection.showNewChatView(projectCwd, projectContainer)
    })

  const handleNewChatNoProject = (): void =>
    startTransition(() => {
      onConversationRequested?.()
      chatRead.markSelectedChatSeen()
      chatState.selectedChatKeyRef.current = null
      chatState.selectedChatUpdatedAtRef.current = null
      subagentState.subagentChatLoadRequestRef.current += 1
      subagentState.setSubagentChatView(null)
      chatProjection.showNewChatView(null)
      sourceState.setNewSessionLocation('folder')
    })

  const handleNewChatInCwd = (group: ChatListGroupData): void =>
    startTransition(() => {
      onConversationRequested?.()
      if (group.kind !== 'cwd') return

      chatRead.markSelectedChatSeen()
      chatState.selectedChatKeyRef.current = null
      chatState.selectedChatUpdatedAtRef.current = null
      subagentState.subagentChatLoadRequestRef.current += 1
      subagentState.setSubagentChatView(null)
      chatProjection.showNewChatView(group.cwd)
    })

  const handleCloseSearch = (): void => {
    searchState.setSearchOpen(false)
    searchState.setSearchQuery('')
  }

  const handleChatSearchNavigation = (direction: -1 | 1): void => {
    const matches = searchState.chatSearchMatchesRef.current
    if (matches.length === 0) return

    const activeIndex =
      (searchState.chatSearchActiveIndexRef.current + direction + matches.length) % matches.length
    searchState.chatSearchActiveIndexRef.current = activeIndex
    searchState.setChatSearchActiveIndex(activeIndex)
    setChatSearchHighlights(matches, activeIndex)
    const contentElement = viewportState.contentRef.current
    const chatKey = chatState.selectedChatKeyRef.current
    if (viewportState.chatAutoScrollEnabledRef.current && contentElement && chatKey) {
      viewportState.chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, chatKey)
    }
    viewportState.chatAutoScrollEnabledRef.current = false
    viewportState.chatAutoScrollTargetRef.current = null

    const activeMatch = matches[activeIndex]
    const scrollContainer = viewportState.contentRef.current
    if (activeMatch && scrollContainer) {
      scrollChatSearchMatchIntoView(activeMatch, scrollContainer)
    }
  }
  return {
    handleSelectChat,
    openLinkedChat,
    handleBack,
    handleNewChat,
    handleNewChatNoProject,
    handleNewChatInCwd,
    handleCloseSearch,
    handleChatSearchNavigation
  }
}
