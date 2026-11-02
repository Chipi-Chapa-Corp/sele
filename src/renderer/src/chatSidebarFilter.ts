import type { ProviderChat } from '../../shared/provider'
import { preferences } from './preferences.ts'

export const chatSidebarFilters = [
  { value: 'all', label: 'All chats', description: 'All chats, excluding sleeping chats.' },
  {
    value: 'attention',
    label: 'Needs attention',
    description: 'Unread chats, questions, approvals, and failures.'
  },
  { value: 'sleeping', label: 'Sleeping chats', description: 'Chats that are sleeping.' },
  { value: 'working', label: 'Working chats', description: 'Chats that are in progress.' }
] as const

export type ChatSidebarFilter = (typeof chatSidebarFilters)[number]['value']
export type ChatSidebarTabs = Record<ChatSidebarFilter, boolean>
const storageKey = 'sele:chat-sidebar-tabs:v1'
const selectedFilterStorageKey = 'sele:chat-sidebar-filter:v1'
const defaultTabs: ChatSidebarTabs = { all: true, attention: true, sleeping: true, working: true }

export const readChatSidebarFilter = (): ChatSidebarFilter => {
  const stored = preferences.getItem(selectedFilterStorageKey)
  return chatSidebarFilters.find(({ value }) => value === stored)?.value ?? 'all'
}

export const writeChatSidebarFilter = (filter: ChatSidebarFilter): void => {
  preferences.setItem(selectedFilterStorageKey, filter)
}

export const readChatSidebarTabs = (): ChatSidebarTabs => {
  try {
    const stored: unknown = JSON.parse(preferences.getItem(storageKey) ?? 'null')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaultTabs
    const tabs = { ...defaultTabs }
    for (const { value } of chatSidebarFilters) {
      if (typeof stored[value] === 'boolean') tabs[value] = stored[value]
    }
    return tabs
  } catch (error) {
    console.error('[caught:chatSidebarFilter:readChatSidebarTabs]', error)
    return defaultTabs
  }
}

export const writeChatSidebarTabs = (tabs: ChatSidebarTabs): void => {
  preferences.setItem(storageKey, JSON.stringify(tabs))
}

export const matchesChatSidebarFilter = (
  chat: Pick<
    ProviderChat,
    'status' | 'lastTurnOutcome' | 'pendingApproval' | 'updatedAt' | 'seenUpdatedAt' | 'done'
  >,
  filter: ChatSidebarFilter,
  { sleeping = false, selected = false, working = false, latestCommitFinishedAt = 0 } = {}
): boolean => {
  if (filter === 'sleeping') return sleeping
  if (sleeping) return false
  if (filter === 'working') return chat.status === 'active' || working
  if (filter === 'attention') {
    return (
      chat.status === 'waitingOnUserInput' ||
      chat.status === 'waitingOnApproval' ||
      Boolean(chat.pendingApproval) ||
      chat.status === 'error' ||
      chat.lastTurnOutcome === 'failed' ||
      (!selected &&
        !chat.done &&
        Math.max(chat.updatedAt, latestCommitFinishedAt) > (chat.seenUpdatedAt ?? 0))
    )
  }
  return true
}
