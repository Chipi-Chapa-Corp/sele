import { createContext, useCallback, useSyncExternalStore } from 'react'
import { createChatSleepStore, type ChatWakeAt } from './chatSleepStore.ts'
import { preferences as preferenceStorage } from './preferences'

export const ChatSleepActionsContext = createContext<'sleep' | 'wake' | false>('sleep')

const store = createChatSleepStore({ storage: preferenceStorage })

export const getChatSleepKey = (providerId: string, chatId: string): string =>
  `${providerId}:${chatId}`

export const sleepChat = store.sleep
export const sleepChats = store.sleepMany

export const wakeChat = store.wake
export const wakeChats = store.wakeMany

export const useSleepingChats = (): ReadonlyMap<string, ChatWakeAt> =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

/** The chat's wake time, null when it sleeps without a timer, undefined when it is awake. */
export const useChatWakeAt = (key: string): ChatWakeAt | undefined => {
  const subscribeKey = useCallback(
    (listener: () => void) => store.subscribeKey(key, listener),
    [key]
  )
  const snapshot = useCallback(() => store.getSnapshot().get(key), [key])
  return useSyncExternalStore(subscribeKey, snapshot, snapshot)
}
