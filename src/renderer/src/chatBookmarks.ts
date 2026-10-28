import { useSyncExternalStore } from 'react'
import { preferences as preferenceStorage } from './preferences'

export const chatBookmarksStorageKey = 'sele:bookmarked-chats:v1'

export const hideBookmarkedChatsStorageKey = 'sele:hide-bookmarked-chats:v1'

export const readHideBookmarkedChats = (): boolean => {
  try {
    return preferenceStorage.getItem(hideBookmarkedChatsStorageKey) !== 'false'
  } catch (error) {
    console.error('[caught:chatBookmarks:readHideBookmarkedChats]', error)
    return true
  }
}

export const writeHideBookmarkedChats = (hide: boolean): void => {
  try {
    preferenceStorage.setItem(hideBookmarkedChatsStorageKey, hide ? 'true' : 'false')
  } catch (error) {
    console.error('[caught:chatBookmarks:writeHideBookmarkedChats]', error)
  }
}

const listeners = new Set<() => void>()
let bookmarkedChatKeys: ReadonlySet<string> = new Set()
let initialized = false

export const getChatBookmarkKey = (providerId: string, chatId: string): string =>
  `${providerId}:${chatId}`

const readStoredChatBookmarks = (): ReadonlySet<string> => {
  try {
    const storedValue = preferenceStorage.getItem(chatBookmarksStorageKey)
    if (!storedValue) return new Set()
    const parsed: unknown = JSON.parse(storedValue)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
    )
  } catch (error) {
    console.error('[caught:chatBookmarks:readStoredChatBookmarks]', error)
    return new Set()
  }
}

const writeStoredChatBookmarks = (keys: ReadonlySet<string>): void => {
  try {
    if (keys.size === 0) {
      preferenceStorage.removeItem(chatBookmarksStorageKey)
      return
    }
    preferenceStorage.setItem(chatBookmarksStorageKey, JSON.stringify([...keys]))
  } catch (error) {
    console.error('[caught:chatBookmarks:writeStoredChatBookmarks]', error)
  }
}

const initialize = (): void => {
  if (initialized) return
  initialized = true
  bookmarkedChatKeys = readStoredChatBookmarks()
}

const notify = (): void => {
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void): (() => void) => {
  initialize()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): ReadonlySet<string> => {
  initialize()
  return bookmarkedChatKeys
}

export const setChatBookmarked = (key: string, bookmarked: boolean): void => {
  initialize()
  if (bookmarkedChatKeys.has(key) === bookmarked) return
  const next = new Set(bookmarkedChatKeys)
  if (bookmarked) next.add(key)
  else next.delete(key)
  bookmarkedChatKeys = next
  writeStoredChatBookmarks(next)
  notify()
}

export const useBookmarkedChatKeys = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
