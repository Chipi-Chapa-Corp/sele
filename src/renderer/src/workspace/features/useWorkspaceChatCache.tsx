import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { asChatPreview, chatPreviewSourceKey } from '../../../../shared/chatPreview'
import type { ProviderChat, ProviderChatDetail, ProviderId } from '../../../../shared/provider'
import { conversationViews } from '../../conversationViews'
import {
  getChatKey,
  getProviderChatKey,
  isActiveChatStatus,
  trimRecentChatCache
} from '../chatControllerUtils'
import { type RecentChatCacheEntry } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'

type WorkspaceChatCacheDependencies = {
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  chatState: ReturnType<typeof useWorkspaceChatState>
}

export function useWorkspaceChatCache({
  settings,
  providerState,
  chatState
}: WorkspaceChatCacheDependencies) {
  const recentChatCacheLimitRef = useRef(settings.effectiveAppSettings.chat.recentChatCacheLimit)

  const recentChatCacheRef = useRef(new Map<string, RecentChatCacheEntry>())

  useEffect(() => {
    const limit = settings.effectiveAppSettings.chat.recentChatCacheLimit
    recentChatCacheLimitRef.current = limit
    if (limit === 0) {
      recentChatCacheRef.current.clear()
      return
    }

    trimRecentChatCache(recentChatCacheRef.current, limit)
  }, [settings.effectiveAppSettings.chat.recentChatCacheLimit])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the account revision invalidates both caches
  useLayoutEffect(() => {
    // Account changes invalidate pending admissions as well as readable snapshots.
    recentChatCacheRef.current.clear()
    conversationViews.clear()
  }, [providerState.providerAccountRevision])

  const removeRecentChatCacheEntry = useCallback((providerId: ProviderId, chatId: string): void => {
    recentChatCacheRef.current.delete(getProviderChatKey(providerId, chatId))
  }, [])

  const cacheRecentChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      updatedAt: number,
      force = false
    ): void => {
      const cache = recentChatCacheRef.current
      if (!detail.historyPreview) conversationViews.install(providerId, [detail])
      const limit = recentChatCacheLimitRef.current
      const cacheKey = getProviderChatKey(providerId, detail.id)

      if (limit === 0 || detail.done || detail.purpose) {
        cache.delete(cacheKey)
        return
      }
      if (detail.historyPreview) return
      if (!force && chatState.selectedChatKeyRef.current !== cacheKey && !cache.has(cacheKey))
        return
      const cachedDetail = cache.get(cacheKey)?.detail
      if (cachedDetail && detail.revision <= cachedDetail.revision) return

      cache.delete(cacheKey)
      cache.set(cacheKey, { detail, updatedAt })
      trimRecentChatCache(cache, limit)
    },
    []
  )

  const getRecentCachedChatDetail = useCallback((chat: ProviderChat): ProviderChatDetail | null => {
    if (recentChatCacheLimitRef.current === 0) return conversationViews.get(chat)

    const cache = recentChatCacheRef.current
    const cacheKey = getChatKey(chat)
    const entry = cache.get(cacheKey)
    if (!entry) return conversationViews.get(chat)
    if (chatPreviewSourceKey(entry.detail.container) !== chatPreviewSourceKey(chat.container))
      return conversationViews.get(chat)

    if (
      entry.detail.historyPreview ||
      entry.detail.done ||
      entry.detail.purpose ||
      entry.updatedAt < chat.updatedAt ||
      entry.detail.status !== chat.status
    ) {
      // A background stream makes the cached detail stale, but it still contains
      // the mounted history window. Replacing it with a different saved window
      // would unmount that history on every switch. Keep it read-only until the
      // independent provider refresh supplies the current transcript/permissions.
      if (isActiveChatStatus(chat.status)) return asChatPreview(entry.detail)
      return conversationViews.get(chat) ?? asChatPreview(entry.detail)
    }

    cache.delete(cacheKey)
    cache.set(cacheKey, entry)
    return entry.detail
  }, [])
  return {
    recentChatCacheLimitRef,
    recentChatCacheRef,
    removeRecentChatCacheEntry,
    cacheRecentChatDetail,
    getRecentCachedChatDetail
  }
}
