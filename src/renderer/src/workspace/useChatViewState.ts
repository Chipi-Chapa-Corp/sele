import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProviderChat, ProviderChatDetail } from '../../../shared/provider'

export type ChatViewState = {
  selectedChat: ProviderChat | null
  chatDetail: ProviderChatDetail | null
}

const resolveUpdate = <Value>(update: SetStateAction<Value>, current: Value): Value =>
  typeof update === 'function' ? (update as (current: Value) => Value)(current) : update

// Selection and its readable snapshot share one queue. An urgent provider update
// cannot publish a different chat's transcript ahead of a pending navigation.
export function useChatViewState() {
  const [view, setView] = useState<ChatViewState>({ selectedChat: null, chatDetail: null })
  const setSelectedChat: Dispatch<SetStateAction<ProviderChat | null>> = useCallback((update) => {
    setView((current) => {
      const selectedChat = resolveUpdate(update, current.selectedChat)
      if (selectedChat === current.selectedChat) return current
      const sameChat =
        selectedChat?.id === current.selectedChat?.id &&
        selectedChat?.providerId === current.selectedChat?.providerId
      return { selectedChat, chatDetail: sameChat ? current.chatDetail : null }
    })
  }, [])
  const setChatDetail: Dispatch<SetStateAction<ProviderChatDetail | null>> = useCallback(
    (update) => {
      setView((current) => {
        // Empty/functional updates have no explicit chat ID. Keep the scope of
        // their originating render when React rebases them after navigation.
        if (
          (update === null || typeof update === 'function') &&
          (current.selectedChat?.id !== view.selectedChat?.id ||
            current.selectedChat?.providerId !== view.selectedChat?.providerId)
        )
          return current
        const chatDetail = resolveUpdate(update, current.chatDetail)
        if (chatDetail === current.chatDetail) return current
        if (chatDetail && chatDetail.id !== current.selectedChat?.id) return current
        return { ...current, chatDetail }
      })
    },
    [view.selectedChat?.id, view.selectedChat?.providerId]
  )
  const selectChatView = useCallback(
    (selectedChat: ProviderChat | null, chatDetail: ProviderChatDetail | null) => {
      setView({ selectedChat, chatDetail: chatDetail?.id === selectedChat?.id ? chatDetail : null })
    },
    []
  )
  return { ...view, setSelectedChat, setChatDetail, selectChatView }
}
