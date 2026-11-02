import { createContext } from 'react'
import type { ProviderChat } from '../../shared/provider'
import { preferences } from './preferences.ts'

const storageKey = 'sele:manually-unread-chats:v1'

export const readManuallyUnreadChats = (): ReadonlySet<string> => {
  const stored: unknown = JSON.parse(preferences.getItem(storageKey) ?? '[]')
  return new Set(
    Array.isArray(stored)
      ? stored.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : []
  )
}

export const writeManuallyUnreadChats = (keys: ReadonlySet<string>): void => {
  if (keys.size === 0) preferences.removeItem(storageKey)
  else preferences.setItem(storageKey, JSON.stringify([...keys]))
}

export const ChatReadStateContext = createContext<{
  manuallyUnreadChatKeys: ReadonlySet<string>
  onMarkRead: ((chat: ProviderChat, read: boolean) => void) | null
}>({ manuallyUnreadChatKeys: new Set(), onMarkRead: null })
