import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { ProviderChat } from '../../shared/provider'
import { chatTerminalActivity } from './chatTerminalActivity'
import { preferences } from './preferences'
import { providerApi } from './providerApi'

const storageKey = 'sele:terminal-chat-unread:v1'

export const useChatTerminalStatus = (key: string) =>
  useSyncExternalStore(
    chatTerminalActivity.subscribe,
    () => chatTerminalActivity.getSnapshot(key),
    () => chatTerminalActivity.getSnapshot(key)
  )

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
    let disposed = false
    let polling = false
    const discovered = new Set<string>()
    const running = new Set<string>()
    const poll = async () => {
      if (polling) return
      polling = true
      const requested = new Set(chatTerminalActivity.takeProbes())
      const targets = chatsRef.current.filter((chat) => {
        const key = `${chat.providerId}:${chat.id}`
        return (
          !discovered.has(key) || running.has(key) || requested.has(key) || chat.status === 'active'
        )
      })
      try {
        for (let index = 0; index < targets.length && !disposed; index += 4) {
          await Promise.all(
            targets.slice(index, index + 4).map(async (chat) => {
              const key = `${chat.providerId}:${chat.id}`
              discovered.add(key)
              try {
                const ids = await providerApi.getChatTerminalTasks(chat.providerId, chat.id)
                if (disposed) return
                if (ids.length) running.add(key)
                else running.delete(key)
                chatTerminalActivity.report(key, 'agent', ids)
              } catch (error) {
                console.error('Unable to read chat terminal activity.', error)
              }
            })
          )
        }
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])
}
