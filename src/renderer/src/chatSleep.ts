import { useCallback, useSyncExternalStore } from 'react'
import { createChatSleepStore, type ChatWakeAt } from './chatSleepStore.ts'
import { preferences as preferenceStorage } from './preferences'

const hideSleepingChatsStorageKey = 'sele:hide-sleeping-chats:v1'
const legacyHideBookmarkedChatsStorageKey = 'sele:hide-bookmarked-chats:v1'

export const readHideSleepingChats = (): boolean => {
  try {
    const stored =
      preferenceStorage.getItem(hideSleepingChatsStorageKey) ??
      preferenceStorage.getItem(legacyHideBookmarkedChatsStorageKey)
    return stored !== 'false'
  } catch (error) {
    console.error('[caught:chatSleep:readHideSleepingChats]', error)
    return true
  }
}

export const writeHideSleepingChats = (hide: boolean): void => {
  try {
    preferenceStorage.setItem(hideSleepingChatsStorageKey, hide ? 'true' : 'false')
    preferenceStorage.removeItem(legacyHideBookmarkedChatsStorageKey)
  } catch (error) {
    console.error('[caught:chatSleep:writeHideSleepingChats]', error)
  }
}

const store = createChatSleepStore({ storage: preferenceStorage })

export const getChatSleepKey = (providerId: string, chatId: string): string =>
  `${providerId}:${chatId}`

export const sleepChat = store.sleep

export const wakeChat = store.wake

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
