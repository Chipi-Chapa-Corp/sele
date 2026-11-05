import { startTransition, useCallback } from 'react'
import type { AppContainerTarget } from '../../../../shared/app'
import { asChatPreview } from '../../../../shared/chatPreview'
import type {
  ProviderChatDetail,
  ProviderChatUpdateSummary,
  ProviderId
} from '../../../../shared/provider'
import {
  preserveOptimisticChatDetail,
  shouldPreserveOptimisticTurnUntilUserMessage
} from '../../chatDetailWindow'
import { reuseChatSnapshotItems } from '../../chatSnapshotItems'
import { mergeChatUpdate } from '../../chatListUpdates'
import { isContainerTargetAvailable, normalizeContainerTarget } from '../../containerSelection'
import {
  areChatsEqual,
  areContainerTargetsEqual,
  getChatFromDetail,
  getChatFromUpdateSummary,
  getProviderChatKey,
  isActiveChatStatus,
  isChatDetailSnapshotStale
} from '../chatControllerUtils'
import { type ApplyChatDetailOptions } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceGitState } from '../state/useWorkspaceGitState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceChatCache } from './useWorkspaceChatCache'

type WorkspaceChatProjectionDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  chatCache: ReturnType<typeof useWorkspaceChatCache>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  gitState: ReturnType<typeof useWorkspaceGitState>
}

export function useWorkspaceChatProjection({
  chatState,
  chatCache,
  searchState,
  sourceState,
  gitState
}: WorkspaceChatProjectionDependencies) {
  const applyChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      options: ApplyChatDetailOptions = {}
    ): void => {
      const updatedAt = detail.updatedAt ?? Date.now()
      const detailKey = getProviderChatKey(providerId, detail.id)
      const currentDetail = chatState.chatDetailRef.current
      const replacesEqualRevision =
        options.allowEqualRevision === true &&
        currentDetail?.id === detail.id &&
        currentDetail.revision === detail.revision
      if (isChatDetailSnapshotStale(detail, currentDetail) && !replacesEqualRevision) {
        if (options.select || chatState.selectedChatKeyRef.current === detailKey)
          startTransition(() => chatState.setChatLoadState('ready'))
        return
      }
      const appliedDetail = reuseChatSnapshotItems(
        currentDetail,
        shouldPreserveOptimisticTurnUntilUserMessage(providerId) &&
          isActiveChatStatus(detail.status) &&
          currentDetail?.id === detail.id &&
          (options.select || chatState.selectedChatKeyRef.current === detailKey)
          ? preserveOptimisticChatDetail(currentDetail, detail)
          : detail
      )
      if (options.select || chatState.selectedChatKeyRef.current === detailKey) {
        chatState.chatDetailRef.current = appliedDetail
        chatState.selectedChatUpdatedAtRef.current = options.select
          ? updatedAt
          : Math.max(chatState.selectedChatUpdatedAtRef.current ?? 0, updatedAt)
      }
      chatCache.cacheRecentChatDetail(providerId, appliedDetail, updatedAt, options.select)

      const hiddenCommit = Boolean(appliedDetail.purpose)
      if (hiddenCommit) {
        chatState.setChats((currentChats) =>
          currentChats.filter(
            (chat) => chat.providerId !== providerId || chat.id !== appliedDetail.id
          )
        )
        if (!options.select && chatState.selectedChatKeyRef.current !== detailKey) return
      }

      if (options.select) {
        searchState.resetChatSearch()
        chatState.selectChatView(
          getChatFromDetail(providerId, appliedDetail, null, updatedAt),
          appliedDetail
        )
        chatState.setChatLoadState('ready')
        sourceState.setNewChatOpen(false)
      } else {
        if (chatState.selectedChatKeyRef.current === detailKey) {
          chatState.setChatDetail(appliedDetail)
          chatState.setChatLoadState('ready')
        }
        chatState.setSelectedChat((currentChat) =>
          currentChat?.providerId === providerId && currentChat.id === appliedDetail.id
            ? getChatFromDetail(providerId, appliedDetail, currentChat, updatedAt)
            : currentChat
        )
      }

      if (hiddenCommit) return

      chatState.setChats((currentChats) => {
        const existingChat =
          currentChats.find(
            (chat) => chat.providerId === providerId && chat.id === appliedDetail.id
          ) ?? null
        const nextChat = getChatFromDetail(providerId, appliedDetail, existingChat, updatedAt)

        return mergeChatUpdate(currentChats, nextChat)
      })
    },
    [
      chatCache.cacheRecentChatDetail,
      searchState.resetChatSearch,
      chatState.chatDetailRef,
      chatState.selectedChatKeyRef,
      chatState.selectedChatUpdatedAtRef,
      chatState.setChatLoadState,
      chatState.setChats,
      chatState.selectChatView,
      chatState.setChatDetail,
      chatState.setSelectedChat,
      sourceState.setNewChatOpen
    ]
  )

  const applyChatSummary = useCallback(
    (providerId: ProviderId, summary: ProviderChatUpdateSummary, turnCompleted: boolean): void => {
      const summaryKey = getProviderChatKey(providerId, summary.id)
      // The send IPC can resolve after a newer completion event has already updated this chat.
      if (
        chatState.selectedChatKeyRef.current === summaryKey &&
        chatState.chatDetailRef.current?.id === summary.id &&
        summary.revision < chatState.chatDetailRef.current.revision
      ) {
        return
      }
      const cacheKey = getProviderChatKey(providerId, summary.id)
      const cached = chatCache.recentChatCacheRef.current.get(cacheKey)
      if (cached) {
        chatCache.recentChatCacheRef.current.set(cacheKey, {
          ...cached,
          detail: asChatPreview(cached.detail)
        })
      }
      const hiddenCommit = Boolean(summary.purpose)
      if (hiddenCommit) {
        chatState.setChats((currentChats) =>
          currentChats.filter((chat) => chat.providerId !== providerId || chat.id !== summary.id)
        )
        if (chatState.selectedChatKeyRef.current !== summaryKey) return
      }

      if (chatState.selectedChatKeyRef.current === summaryKey) {
        chatState.selectedChatUpdatedAtRef.current = Math.max(
          chatState.selectedChatUpdatedAtRef.current ?? 0,
          summary.updatedAt
        )
      }
      chatState.setSelectedChat((currentChat) => {
        if (currentChat?.providerId !== providerId || currentChat.id !== summary.id) {
          return currentChat
        }

        const nextChat = getChatFromUpdateSummary(providerId, summary, currentChat, turnCompleted)
        return areChatsEqual(currentChat, nextChat) ? currentChat : nextChat
      })
      if (hiddenCommit) return

      chatState.setChats((currentChats) => {
        const existingChat =
          currentChats.find((chat) => chat.providerId === providerId && chat.id === summary.id) ??
          null
        const nextChat = getChatFromUpdateSummary(providerId, summary, existingChat, turnCompleted)
        if (existingChat && areChatsEqual(existingChat, nextChat)) return currentChats

        return mergeChatUpdate(currentChats, nextChat)
      })
    },
    [
      chatState.selectedChatKeyRef,
      chatState.chatDetailRef,
      chatState.selectedChatUpdatedAtRef,
      chatState.setSelectedChat,
      chatState.setChats,
      chatCache.recentChatCacheRef
    ]
  )

  const showNewChatView = useCallback(
    (projectCwd?: string | null, container?: AppContainerTarget | null): void => {
      searchState.resetChatSearch()
      gitState.setCommitChatReturnTarget(null)
      chatState.chatDetailRef.current = null
      chatState.setSelectedChat(null)
      chatState.setChatDetail(null)
      chatState.setChatLoadState('ready')
      chatState.setSendState(chatState.sendInFlightRef.current ? 'sending' : 'idle')
      chatState.setEditingMessage(null)
      searchState.setSearchOpen(false)
      searchState.setSearchQuery('')
      if (projectCwd !== undefined) sourceState.setNewSessionCwd(projectCwd)
      if (container !== undefined) {
        const normalizedContainer = normalizeContainerTarget(container)
        const nextContainer = isContainerTargetAvailable(
          normalizedContainer,
          sourceState.containerSuggestions,
          sourceState.sshEnvironments
        )
          ? normalizedContainer
          : { kind: 'host' as const }
        // Keep the existing source identity when completion opens the composer
        // in the same container; replacing it would reload every provider chat.
        sourceState.setNewSessionContainer((currentContainer) =>
          areContainerTargetsEqual(currentContainer, nextContainer)
            ? currentContainer
            : nextContainer
        )
      }
      sourceState.setNewChatOpen(true)
    },
    [
      sourceState.containerSuggestions,
      searchState.resetChatSearch,
      searchState.setSearchOpen,
      searchState.setSearchQuery,
      gitState.setCommitChatReturnTarget,
      chatState.chatDetailRef,
      chatState.setSelectedChat,
      chatState.setChatDetail,
      chatState.setChatLoadState,
      chatState.setSendState,
      chatState.sendInFlightRef,
      chatState.setEditingMessage,
      sourceState.setNewSessionCwd,
      sourceState.setNewSessionContainer,
      sourceState.sshEnvironments,
      sourceState.setNewChatOpen
    ]
  )
  return { applyChatDetail, applyChatSummary, showNewChatView }
}
