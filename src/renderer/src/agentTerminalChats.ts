import type { ProviderChat } from '../../shared/provider'

// The terminal panel also owns tabs for chats other than the selected conversation.
const chats = new Map<string, ProviderChat>()
export const rememberAgentTerminalChats = (values: ProviderChat[]): void => {
  for (const chat of values) chats.set(`${chat.providerId}:${chat.id}`, chat)
}
export const getAgentTerminalChat = (key: string): ProviderChat | undefined => chats.get(key)
export const getAgentTerminalTabLabel = (title: string, index: number): string => {
  const name = title.trim().replace(/\s+/g, ' ') || 'Chat'
  return `${name.length > 20 ? `${name.slice(0, 19)}…` : name} ${index}`
}
