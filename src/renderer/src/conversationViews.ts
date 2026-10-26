import type { ProviderChat, ProviderChatDetail, ProviderId } from '../../shared/provider'
import { chatPreviewSourceKey } from '../../shared/chatPreview.ts'
import {
  createConversationView,
  isConversationOpeningDetail,
  restoreConversationView
} from '../../shared/conversationView.ts'
import { buildChatConversationModel } from './chatConversationModel.ts'

const keyOf = (provider: ProviderId, id: string, container: ProviderChat['container']) =>
  JSON.stringify([provider, chatPreviewSourceKey(container), id])

/** Opening is a synchronous lookup. Install projections before publishing their sidebar rows. */
export const createConversationViews = () => {
  const views = new Map<string, ProviderChatDetail>()
  const liveRevisions = new Map<string, number>()
  const install = (
    provider: ProviderId,
    details: readonly ProviderChatDetail[],
    live = false
  ): void => {
    for (const detail of details) {
      if (!detail.conversationView && !isConversationOpeningDetail(detail)) continue
      const view = detail.conversationView ? detail : createConversationView(detail)
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
    clear: (): void => {
      views.clear()
      liveRevisions.clear()
    }
  }
}

export const conversationViews = createConversationViews()
