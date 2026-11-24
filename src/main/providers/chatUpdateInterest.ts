// Main-process view subscriptions. Desktop and LAN clients can watch the same conversation.
// A window watches its viewed chat and, for a benchmark, the hidden secondary agent's chat.
const viewedChats = new Map<number, readonly string[]>()

export const setChatUpdateInterest = (
  windowId: number,
  chatKeys: readonly string[] | null
): void => {
  if (!chatKeys?.length) viewedChats.delete(windowId)
  else viewedChats.set(windowId, [...chatKeys])
}

export const hasChatUpdateInterest = (chatKey: string): boolean => {
  for (const viewed of viewedChats.values()) if (viewed.includes(chatKey)) return true
  return false
}
