import type { ProviderChat, ProviderChatDetail, ProviderId } from '../../shared/provider'
import { chatPreviewSourceKey } from '../../shared/chatPreview.ts'
import {
  createConversationOpening,
  createConversationView,
  isConversationOpeningDetail,
  restoreConversationView
} from '../../shared/conversationView.ts'
import { buildChatConversationModel } from './chatConversationModel.ts'

const keyOf = (provider: ProviderId, id: string, container: ProviderChat['container']) =>
  JSON.stringify([provider, chatPreviewSourceKey(container), id])

/** Prepared openings are synchronous; missing viewports are fetched on navigation intent. */
export const createConversationViews = () => {
  const views = new Map<string, ProviderChatDetail>()
  const liveRevisions = new Map<string, number>()
  const pending = new Map<string, Promise<ProviderChatDetail | null>>()
  let generation = 0
  const install = (
    provider: ProviderId,
    details: readonly ProviderChatDetail[],
    live = false
  ): void => {
    for (const detail of details) {
      if (!detail.conversationView && !isConversationOpeningDetail(detail)) continue
      const source = detail.conversationView ? detail : createConversationView(detail)
      // This registry outlives the full-history LRU. Keep only a readable viewport;
      // otherwise every visited large turn (including tool output) lives forever.
      const large =
        source.items.length > 3 ||
        source.items.some((item) =>
          item.type === 'working'
            ? item.items.length > 0
            : (item.type === 'message' || item.type === 'pendingMessage') &&
              (item.content.length > 8192 ||
                item.attachments?.some(
                  (attachment) =>
                    attachment.kind === 'image' && (attachment.dataUrl?.length ?? 0) > 8192
                ))
        )
      const view = large ? createConversationOpening(source) : source
      const key = keyOf(provider, view.id, view.container)
      const isLive = live || !detail.conversationView
      const previousRevision = liveRevisions.get(key)
      const revision = view.conversationViewSourceRevision ?? detail.revision
      // Process-local revisions restart at launch. A restored page is a baseline;
      // once live data arrives, a late database/list reply cannot replace it.
      if (previousRevision !== undefined && (!isLive || revision < previousRevision)) continue
      if (isLive) liveRevisions.set(key, revision)
      buildChatConversationModel(view.items)
      views.set(key, view)
    }
  }
  return {
    install,
    has: (chat: ProviderChat): boolean =>
      views.has(keyOf(chat.providerId, chat.id, chat.container)),
    get: (chat: ProviderChat): ProviderChatDetail | null => {
      const view = views.get(keyOf(chat.providerId, chat.id, chat.container))
      if (!view) return null
      return restoreConversationView(view, chat)
    },
    read: (
      chat: ProviderChat,
      load: () => Promise<ProviderChatDetail | null>,
      speculative = false
    ): Promise<ProviderChatDetail | null> => {
      const key = keyOf(chat.providerId, chat.id, chat.container)
      const ready = views.get(key)
      if (ready) return Promise.resolve(restoreConversationView(ready, chat))
      const existing = pending.get(key)
      if (existing) return existing
      // Hovering many rows must never start an unbounded queue of disk/IPC reads.
      if (speculative && pending.size >= 2) return Promise.resolve(null)
      const epoch = generation
      const request = Promise.resolve()
        .then(load)
        .then((detail) => {
          if (
            epoch !== generation ||
            !detail ||
            keyOf(chat.providerId, detail.id, detail.container) !== key
          )
            return null
          install(chat.providerId, [detail])
          return detail
        })
        .finally(() => {
          if (pending.get(key) === request) pending.delete(key)
        })
      pending.set(key, request)
      return request
    },
    clear: (): void => {
      generation++
      pending.clear()
      views.clear()
      liveRevisions.clear()
    }
  }
}

export const conversationViews = createConversationViews()
