import type { ProviderChat, ProviderChatDetail } from '../../shared/provider'
import { preloadChatDetailItem } from './components/LazyChatDetailItem'
import { conversationViews } from './conversationViews'
import { providerApi } from './providerApi'

export const readChatOpening = (
  chat: ProviderChat,
  speculative = false
): Promise<ProviderChatDetail | null> =>
  conversationViews.read(
    chat,
    () =>
      providerApi.getCachedChat?.(chat.providerId, chat.id, {
        container: chat.container,
        opening: true
      }) ?? Promise.resolve(null),
    speculative
  )

export const prefetchChatOpening = (chat: ProviderChat, speculative = true): void => {
  preloadChatDetailItem()
  void readChatOpening(chat, speculative).catch((error: unknown) => {
    console.warn('Unable to prepare saved chat messages.', error)
  })
}
