import type { ProviderChat } from '../../shared/provider'
import { preferences } from './preferences.ts'

export const chatSidebarFilters = [
  {
    value: 'all',
    label: 'All chats',
    description: 'All chats, including sleeping and working chats.'
  },
  {
    value: 'active',
    label: 'Active chats',
    description: 'Exclude sleeping and working chats when their tabs are enabled.'
  },
  { value: 'sleeping', label: 'Sleeping chats', description: 'Chats that are sleeping.' },
  { value: 'working', label: 'Working chats', description: 'Chats that are in progress.' }
] as const

export type ChatSidebarFilter = (typeof chatSidebarFilters)[number]['value']
export type ChatSidebarTabs = Record<ChatSidebarFilter, boolean>
const storageKey = 'sele:chat-sidebar-tabs:v1'
const selectedFilterStorageKey = 'sele:chat-sidebar-filter:v1'
const defaultTabs: ChatSidebarTabs = { all: true, active: true, sleeping: true, working: true }

export const readChatSidebarFilter = (): ChatSidebarFilter => {
  const saved = preferences.getItem(selectedFilterStorageKey)
  const stored = saved === 'attention' ? 'active' : saved
  return chatSidebarFilters.find(({ value }) => value === stored)?.value ?? 'active'
}

export const writeChatSidebarFilter = (filter: ChatSidebarFilter): void => {
  preferences.setItem(selectedFilterStorageKey, filter)
}

export const readChatSidebarTabs = (): ChatSidebarTabs => {
  try {
    const stored: unknown = JSON.parse(preferences.getItem(storageKey) ?? 'null')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaultTabs
    const tabs = { ...defaultTabs }
    if (!('active' in stored) && 'attention' in stored && typeof stored.attention === 'boolean') {
      tabs.active = stored.attention
    }
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
  chat: Pick<ProviderChat, 'status'>,
  filter: ChatSidebarFilter,
  { sleeping = false, working = false, tabs = defaultTabs } = {}
): boolean => {
  if (filter === 'all') return true
  if (filter === 'sleeping') return sleeping
  const isWorking = chat.status === 'active' || working
  if (filter === 'working') return isWorking
  return (!tabs.sleeping || !sleeping) && (!tabs.working || !isWorking)
}
