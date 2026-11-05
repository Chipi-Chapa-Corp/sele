import { createContext, useCallback, useSyncExternalStore } from 'react'
import { createChatSleepStore, type ChatWakeAt } from './chatSleepStore.ts'
import { preferences as preferenceStorage } from './preferences'
import {
  chatSleepStorageKey,
  type ChatSleepChange,
  type ChatSleepSnapshot
} from '../../shared/chatSleep'
import { appApi } from './appApi'

export const ChatSleepActionsContext = createContext<'sleep' | 'wake' | false>('sleep')

let shared = false
let cached: string | null = null
let canonical: ChatSleepSnapshot = { revision: -1, sleeping: {} }
const pending: { changes: ChatSleepChange[] }[] = []
let writes = Promise.resolve()
const store = createChatSleepStore({
  storage: {
    getItem: (key) =>
      shared ? (key === chatSleepStorageKey ? cached : null) : preferenceStorage.getItem(key),
    setItem: (key, value) => {
      if (shared) cached = value
      else preferenceStorage.setItem(key, value)
    },
    removeItem: (key) => {
      if (shared) cached = null
      else preferenceStorage.removeItem(key)
    }
  },
  onChange: (changes) => {
    if (!shared) return
    const operation = { changes }
    pending.push(operation)
    const removePending = (): void => {
      const index = pending.indexOf(operation)
      if (index >= 0) pending.splice(index, 1)
    }
    writes = writes
      .then(() => appApi.updateChatSleep(changes))
      .then((state) => {
        removePending()
        applySnapshot(state)
      })
      .catch((error) => {
        removePending()
        applySnapshot(canonical)
        console.warn('Unable to sync sleeping chats. Reconnect and retry.', error)
      })
  }
})

const applySnapshot = (snapshot: ChatSleepSnapshot): void => {
  if (snapshot.revision >= canonical.revision) canonical = snapshot
  const next = new Map(Object.entries(canonical.sleeping))
  for (const operation of pending)
    for (const change of operation.changes) {
      if (change.expected !== undefined && next.get(change.key) !== change.expected) continue
      if (change.wakeAt === false) next.delete(change.key)
      else next.set(change.key, change.wakeAt)
    }
  store.replace(next)
}

export const initializeChatSleep = async (): Promise<void> => {
  shared = true
  appApi.onChatSleepUpdated(applySnapshot)
  applySnapshot(await appApi.getChatSleep())
}

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
