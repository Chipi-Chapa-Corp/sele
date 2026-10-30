import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ProviderChat } from '../../shared/provider'
import { chatTerminalActivity } from './chatTerminalActivity'
import { createChatTerminalPoller } from './chatTerminalPolling'
import { preferences } from './preferences'
import { providerApi } from './providerApi'

const storageKey = 'sele:terminal-chat-unread:v1'

export const useChatTerminalStatus = (key: string) => {
  const subscribe = useCallback(
    (listener: () => void) => chatTerminalActivity.subscribeKey(key, listener),
    [key]
  )
  const snapshot = useCallback(() => chatTerminalActivity.getSnapshot(key), [key])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export const useChatTerminalActivity = (
  chats: ProviderChat[],
  selectedChat: ProviderChat | null
): void => {
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  useEffect(() => {
    const raw = preferences.getItem(storageKey)
    let stored: unknown = []
    try {
      stored = JSON.parse(raw ?? '[]')
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      console.error('Unable to read saved terminal completion markers.', error)
    }
    chatTerminalActivity.initialize(
      Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [],
      (keys) => preferences.setItem(storageKey, JSON.stringify(keys))
    )
  }, [])
  useEffect(() => {
    for (const chat of chats)
      chatTerminalActivity.setIdle(`${chat.providerId}:${chat.id}`, chat.status !== 'active')
  }, [chats])
  const selectedKey = selectedChat ? `${selectedChat.providerId}:${selectedChat.id}` : null
  useEffect(() => {
    if (selectedKey) chatTerminalActivity.markSeen(selectedKey)
  }, [selectedKey])
  useEffect(() => {
    const poller = createChatTerminalPoller({
      getChats: () => chatsRef.current,
      readTasks: providerApi.getChatTerminalTasks,
      activity: chatTerminalActivity,
      onError: (error) => console.error('Unable to read chat terminal activity.', error)
    })
    void poller.poll()
    const timer = window.setInterval(() => void poller.poll(), 1000)
    return () => {
      poller.dispose()
      window.clearInterval(timer)
    }
  }, [])
}
