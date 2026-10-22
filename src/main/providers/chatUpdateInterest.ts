// Main-process view subscriptions. Multiple windows can watch the same conversation.
const viewedChats = new Map<number, string>()

export const setChatUpdateInterest = (windowId: number, chatKey: string | null): void => {
  if (chatKey === null) viewedChats.delete(windowId)
  else viewedChats.set(windowId, chatKey)
}

export const hasChatUpdateInterest = (chatKey: string): boolean => {
  for (const viewed of viewedChats.values()) if (viewed === chatKey) return true
  return false
}
