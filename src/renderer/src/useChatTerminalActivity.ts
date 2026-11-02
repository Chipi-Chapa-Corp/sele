import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ProviderChat } from '../../shared/provider'
import { chatTerminalActivity } from './chatTerminalActivity'
import { createChatTerminalPoller } from './chatTerminalPolling'
import { providerApi } from './providerApi'
import { rememberAgentTerminalChats } from './agentTerminalChats'

export const useChatTerminalStatus = (key: string) => {
  const subscribe = useCallback(
    (listener: () => void) => chatTerminalActivity.subscribeKey(key, listener),
    [key]
  )
  const snapshot = useCallback(() => chatTerminalActivity.getSnapshot(key), [key])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export const useChatTerminalActivity = (chats: ProviderChat[]): void => {
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  useEffect(() => rememberAgentTerminalChats(chats), [chats])
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
