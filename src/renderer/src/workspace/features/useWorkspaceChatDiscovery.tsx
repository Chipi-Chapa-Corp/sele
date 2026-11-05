import { useCallback, useEffect } from 'react'
import type { AppContainerTarget } from '../../../../shared/app'
import type { ProviderId } from '../../../../shared/provider'
import { appApi } from '../../appApi'
import {
  getContainerTargetFromSuggestion,
  getContainerTargetKey,
  normalizeContainerTarget
} from '../../containerSelection'
import { conversationViews } from '../../conversationViews'
import { providerApi } from '../../providerApi'
import { areContainerTargetsEqual, getChatKey, mergeChats } from '../chatControllerUtils'
import { chatListFetchPageSize } from '../controllerTypes'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceSearchState } from '../state/useWorkspaceSearchState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

type WorkspaceChatDiscoveryDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  searchState: ReturnType<typeof useWorkspaceSearchState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
}

export function useWorkspaceChatDiscovery({
  chatState,
  searchState,
  sourceState
}: WorkspaceChatDiscoveryDependencies) {
  const clearSelectedChatIfUnavailableInSource = useCallback(
    (availableProviderIds: ProviderId[], container: AppContainerTarget | null): void => {
      const currentChat = chatState.selectedChatRef.current
      if (
        !currentChat ||
        availableProviderIds.includes(currentChat.providerId) ||
        !areContainerTargetsEqual(currentChat.container, container)
      ) {
        return
      }

      searchState.resetChatSearch()
      chatState.selectedChatRef.current = null
      chatState.selectedChatKeyRef.current = null
      chatState.selectedChatUpdatedAtRef.current = null
      chatState.chatDetailRef.current = null
      chatState.setSelectedChat(null)
      chatState.setChatDetail(null)
      chatState.setChatLoadState('ready')
      chatState.setSendState(chatState.sendInFlightRef.current ? 'sending' : 'idle')
      chatState.setEditingMessage(null)
      sourceState.setNewChatOpen(true)
    },
    [searchState.resetChatSearch]
  )

  useEffect(() => {
    let active = true

    const loadInitialChats = async (): Promise<void> => {
      if (!sourceState.newSessionSourceAvailabilityReady) return

      const container = normalizeContainerTarget(sourceState.newSessionContainer)
      if (sourceState.newSessionAvailableProviderIds.length === 0) {
        clearSelectedChatIfUnavailableInSource([], container)
        chatState.setLoadState('ready')
        return
      }

      const initialChatKeysByProvider = new Map(
        sourceState.newSessionAvailableProviderIds.map((providerId) => [
          providerId,
          new Set(
            chatState.chatsRef.current
              .filter(
                (chat) =>
                  chat.providerId === providerId &&
                  areContainerTargetsEqual(chat.container, container)
              )
              .map(getChatKey)
          )
        ])
      )
      clearSelectedChatIfUnavailableInSource(sourceState.newSessionAvailableProviderIds, container)
      chatState.setLoadState('loading')

      let settledProviderCount = 0
      let loadedProviderCount = 0
      const markProviderSettled = (): void => {
        settledProviderCount += 1
        if (
          settledProviderCount === sourceState.newSessionAvailableProviderIds.length &&
          loadedProviderCount === 0
        ) {
          chatState.setLoadState('error')
        }
      }

      sourceState.newSessionAvailableProviderIds.forEach((providerId) => {
        const loadProviderChats = async (): Promise<void> => {
          let knownCursor: string | null = null
          do {
            const known = await providerApi.getKnownChats(providerId, {
              container,
              cursor: knownCursor,
              limit: chatListFetchPageSize
            })
            if (!active) return
            conversationViews.install(providerId, known.conversationViews ?? [])
            if (known.chats.length) {
              loadedProviderCount += 1
              const initial = initialChatKeysByProvider.get(providerId)
              known.chats.forEach((chat) => initial?.add(getChatKey(chat)))
              chatState.setChats((current) => mergeChats(current, known.chats))
              chatState.setLoadState('ready')
            }
            knownCursor = known.nextCursor
          } while (knownCursor)
          let cursor: string | null = null
          let firstPage = true
          const loadedProviderChatKeys = new Set<string>()
          const seenCursors = new Set<string>()

          do {
            const page = await providerApi.getChats(providerId, {
              container,
              cursor,
              limit: chatListFetchPageSize
            })
            if (!active) return

            conversationViews.install(providerId, page.conversationViews ?? [])

            if (firstPage) loadedProviderCount += 1
            page.chats.forEach((chat) => loadedProviderChatKeys.add(getChatKey(chat)))
            // Keep the previous snapshot mounted while later pages are still loading.
            chatState.setChats((currentChats) => mergeChats(currentChats, page.chats))
            chatState.setLoadState('ready')

            firstPage = false
            cursor = page.nextCursor
            if (cursor && seenCursors.has(cursor)) break
            if (cursor) seenCursors.add(cursor)
          } while (cursor)

          const initialProviderChatKeys = initialChatKeysByProvider.get(providerId) ?? new Set()
          // Once every page is present, discard only stale entries from the original snapshot.
          chatState.setChats((currentChats) =>
            mergeChats(
              currentChats.filter(
                (chat) =>
                  chat.providerId !== providerId ||
                  !initialProviderChatKeys.has(getChatKey(chat)) ||
                  loadedProviderChatKeys.has(getChatKey(chat))
              )
            )
          )
        }

        void loadProviderChats()
          .catch((error: unknown) => {
            console.error(`Unable to load initial chats for ${providerId}.`, error)
            // Other providers should still populate the sidebar.
          })
          .finally(() => {
            if (active) markProviderSettled()
          })
      })
    }

    void loadInitialChats()

    return () => {
      active = false
    }
  }, [
    clearSelectedChatIfUnavailableInSource,
    sourceState.newSessionAvailableProviderIds,
    sourceState.newSessionContainer,
    sourceState.newSessionSourceAvailabilityReady
  ])

  useEffect(() => {
    if (!sourceState.containerSelectionReady) return

    let active = true
    const sourceKeys = new Set<string>()
    const configuredSshEnvironmentIds = new Set(
      sourceState.sshEnvironments.map((environment) => environment.id)
    )
    const sources = (
      [
        { kind: 'host' },
        ...sourceState.sshEnvironments.map(
          (environment): AppContainerTarget => ({
            kind: 'container',
            tool: 'ssh',
            name: environment.id,
            runtime: { kind: 'host' }
          })
        ),
        ...sourceState.containerSuggestions.map(getContainerTargetFromSuggestion),
        ...sourceState.storedChatContainers.filter(
          (container) =>
            container.kind === 'container' &&
            container.tool === 'ssh' &&
            configuredSshEnvironmentIds.has(container.name)
        )
      ] satisfies AppContainerTarget[]
    ).filter((source) => {
      const sourceKey = getContainerTargetKey(source)
      if (sourceKeys.has(sourceKey)) return false
      sourceKeys.add(sourceKey)
      return true
    })

    const loadSourceChats = async (container: AppContainerTarget): Promise<void> => {
      const availability = await appApi.getSourceAvailability({ container })
      if (!active) return

      const availableProviderIds = availability.providers.flatMap((provider) =>
        provider.available ? [provider.providerId] : []
      )

      const results = await Promise.allSettled(
        availableProviderIds.map(async (providerId) => {
          const initialChatKeys = new Set(
            chatState.chatsRef.current
              .filter(
                (chat) =>
                  chat.providerId === providerId &&
                  areContainerTargetsEqual(chat.container, container)
              )
              .map(getChatKey)
          )
          const loadedChatKeys = new Set<string>()
          let knownCursor: string | null = null
          do {
            const known = await providerApi.getKnownChats(providerId, {
              container,
              cursor: knownCursor,
              limit: chatListFetchPageSize
            })
            if (!active) return
            conversationViews.install(providerId, known.conversationViews ?? [])
            known.chats.forEach((chat) => initialChatKeys.add(getChatKey(chat)))
            chatState.setChats((current) => mergeChats(current, known.chats))
            knownCursor = known.nextCursor
          } while (knownCursor)
          const seenCursors = new Set<string>()
          let cursor: string | null = null

          do {
            const page = await providerApi.getChats(providerId, {
              container,
              cursor,
              limit: chatListFetchPageSize
            })
            if (!active) return

            conversationViews.install(providerId, page.conversationViews ?? [])
            page.chats.forEach((chat) => loadedChatKeys.add(getChatKey(chat)))
            chatState.setChats((currentChats) => mergeChats(currentChats, page.chats))

            cursor = page.nextCursor
            if (cursor && seenCursors.has(cursor)) break
            if (cursor) seenCursors.add(cursor)
          } while (cursor)

          chatState.setChats((currentChats) =>
            mergeChats(
              currentChats.filter(
                (chat) =>
                  chat.providerId !== providerId ||
                  !initialChatKeys.has(getChatKey(chat)) ||
                  loadedChatKeys.has(getChatKey(chat))
              )
            )
          )
        })
      )
      results.forEach((result) => {
        if (result.status === 'rejected') {
          console.error('Unable to load chats from a secondary provider.', result.reason)
        }
      })
    }

    sources.forEach((source) => {
      if (getContainerTargetKey(source) === sourceState.newSessionContainerKeyRef.current) return
      void loadSourceChats(source).catch((error: unknown) => {
        console.error('Unable to load chats from a secondary source.', error)
        // Unreachable environments should not hide chats loaded from other sources.
      })
    })

    return () => {
      active = false
    }
  }, [
    sourceState.containerSelectionReady,
    sourceState.containerSuggestions,
    sourceState.sshEnvironments,
    sourceState.storedChatContainers
  ])
  return {}
}
