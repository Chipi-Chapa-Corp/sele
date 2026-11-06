import { startTransition, useCallback, useEffect } from 'react'
import type {
  ProviderChatDetail,
  ProviderChatMetadata,
  ProviderId
} from '../../../../shared/provider'
import { mapPreservingIdentity, mergeChatMetadata, mergeSeenUpdatedAt } from '../../chatMetadata'
import { createChatSeenWriter } from '../../chatSeenWriter'
import { providerApi } from '../../providerApi'
import { getChatKey, getProviderChatKey } from '../chatControllerUtils'
import { type ApplyChatDetailOptions } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceChatCache } from './useWorkspaceChatCache'
import { useWorkspaceChatProjection } from './useWorkspaceChatProjection'

const persistChatSeen = createChatSeenWriter((...args) => providerApi.markChatSeen(...args))

type WorkspaceChatReadStateDependencies = {
  chatCache: ReturnType<typeof useWorkspaceChatCache>
  chatState: ReturnType<typeof useWorkspaceChatState>
  chatProjection: ReturnType<typeof useWorkspaceChatProjection>
}

export function useWorkspaceChatReadState({
  chatCache,
  chatState,
  chatProjection
}: WorkspaceChatReadStateDependencies) {
  const applyChatMetadata = useCallback((metadataList: ProviderChatMetadata[]): void => {
    const metadataById = new Map(metadataList.map((metadata) => [metadata.id, metadata]))
    const recentChatCache = chatCache.recentChatCacheRef.current

    for (const [cacheKey, entry] of recentChatCache) {
      const metadata = metadataById.get(entry.detail.id)
      if (!metadata) continue

      if (metadata.done || metadata.purpose === 'commit') {
        recentChatCache.delete(cacheKey)
        continue
      }

      const detail = mergeChatMetadata(entry.detail, metadata)
      if (detail !== entry.detail) recentChatCache.set(cacheKey, { ...entry, detail })
    }

    chatState.setChats((currentChats) =>
      mapPreservingIdentity(currentChats, (chat) => {
        const metadata = metadataById.get(chat.id)
        return metadata ? mergeChatMetadata(chat, metadata) : chat
      })
    )
    chatState.setSelectedChat((currentChat) => {
      if (!currentChat) return currentChat

      const metadata = metadataById.get(currentChat.id)
      return metadata ? mergeChatMetadata(currentChat, metadata) : currentChat
    })
    chatState.setChatDetail((currentDetail) => {
      if (!currentDetail) return currentDetail

      const metadata = metadataById.get(currentDetail.id)
      return metadata ? mergeChatMetadata(currentDetail, metadata) : currentDetail
    })
  }, [])

  useEffect(
    () =>
      providerApi.onChatMetadataUpdated((metadata) =>
        startTransition(() => applyChatMetadata(metadata))
      ),
    [applyChatMetadata]
  )

  const applySeenUpdatedAt = useCallback(
    (providerId: ProviderId, chatId: string, seenUpdatedAt: number): void => {
      // Keep the same object when it has already seen this update, so repeated
      // seen marks during a chat switch don't rerender the sidebar and conversation.
      const withSeen = <Target extends { seenUpdatedAt: number | null }>(
        target: Target
      ): Target => {
        const nextSeenUpdatedAt = mergeSeenUpdatedAt(target.seenUpdatedAt, seenUpdatedAt)
        return nextSeenUpdatedAt === target.seenUpdatedAt
          ? target
          : { ...target, seenUpdatedAt: nextSeenUpdatedAt }
      }
      const cacheKey = getProviderChatKey(providerId, chatId)
      const cacheEntry = chatCache.recentChatCacheRef.current.get(cacheKey)
      if (cacheEntry) {
        const detail = withSeen(cacheEntry.detail)
        if (detail !== cacheEntry.detail) {
          chatCache.recentChatCacheRef.current.set(cacheKey, { ...cacheEntry, detail })
        }
      }

      chatState.setChats((currentChats) =>
        mapPreservingIdentity(currentChats, (chat) =>
          chat.providerId === providerId && chat.id === chatId ? withSeen(chat) : chat
        )
      )
      chatState.setSelectedChat((currentChat) =>
        currentChat?.providerId === providerId && currentChat.id === chatId
          ? withSeen(currentChat)
          : currentChat
      )
      chatState.setChatDetail((currentDetail) =>
        currentDetail?.id === chatId ? withSeen(currentDetail) : currentDetail
      )
    },
    []
  )

  const markChatSeenAt = useCallback(
    (providerId: ProviderId, chatId: string, seenUpdatedAt: number): void => {
      startTransition(() => applySeenUpdatedAt(providerId, chatId, seenUpdatedAt))

      void persistChatSeen(providerId, chatId, seenUpdatedAt)
        .then((metadata) => {
          if (metadata) startTransition(() => applyChatMetadata([metadata]))
        })
        .catch((error: unknown) => {
          console.error('Unable to persist the chat seen state.', error)
          // Keep the optimistic in-memory seen state if persistence fails.
        })
    },
    [applyChatMetadata, applySeenUpdatedAt]
  )

  const markSelectedChatSeen = useCallback((): void => {
    if (!chatState.selectedChat) return

    const chatKey = getChatKey(chatState.selectedChat)
    const cacheEntry = chatCache.recentChatCacheRef.current.get(chatKey)
    markChatSeenAt(
      chatState.selectedChat.providerId,
      chatState.selectedChat.id,
      Math.max(
        Date.now(),
        chatState.selectedChat.updatedAt,
        chatState.chatDetailRef.current?.id === chatState.selectedChat.id
          ? (chatState.chatDetailRef.current.updatedAt ?? 0)
          : 0,
        chatState.selectedChatUpdatedAtRef.current ?? 0,
        cacheEntry?.updatedAt ?? 0
      )
    )
  }, [markChatSeenAt, chatState.selectedChat])

  const applyViewedChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      options: ApplyChatDetailOptions = {}
    ): void => {
      chatProjection.applyChatDetail(providerId, detail, options)
      markChatSeenAt(providerId, detail.id, detail.updatedAt ?? Date.now())
    },
    [chatProjection.applyChatDetail, markChatSeenAt]
  )
  return { applyChatMetadata, markChatSeenAt, markSelectedChatSeen, applyViewedChatDetail }
}
