import type { ProviderChat } from '../../shared/provider'

export const compareChatsByCreatedAtDesc = (first: ProviderChat, second: ProviderChat): number =>
  second.createdAt - first.createdAt || second.updatedAt - first.updatedAt

/** Replace one summary in an already sorted, unique chat list without rebuilding its index. */
export const mergeChatUpdate = (
  chats: ProviderChat[],
  chat: ProviderChat,
  { authoritativeLifecycle = false } = {}
): ProviderChat[] => {
  const index = chats.findIndex(
    (current) => current.providerId === chat.providerId && current.id === chat.id
  )
  if (index < 0) return [...chats, chat].sort(compareChatsByCreatedAtDesc)
  const current = chats[index]
  if (current === chat) return chats
  if (current.updatedAt > chat.updatedAt) {
    if (!authoritativeLifecycle) return chats
    // A fresh provider revision can stop or resume a turn without advancing the
    // conversation's activity timestamp. Keep newer list metadata in that case.
    const { status, lastTurnOutcome = current.lastTurnOutcome, pendingApproval } = chat
    if (
      current.status === status &&
      current.lastTurnOutcome === lastTurnOutcome &&
      current.pendingApproval === pendingApproval
    )
      return chats
    const next = chats.slice()
    next[index] = { ...current, status, lastTurnOutcome, pendingApproval }
    return next
  }
  const next = chats.slice()
  next[index] = chat
  // Streaming usually changes updatedAt on a chat with a unique creation time,
  // leaving its position unchanged. Sorting and building a Map costs O(n) key
  // allocations on every packet even though only this one entry changed.
  if (
    (index === 0 || compareChatsByCreatedAtDesc(next[index - 1], chat) <= 0) &&
    (index === next.length - 1 || compareChatsByCreatedAtDesc(chat, next[index + 1]) <= 0)
  )
    return next
  return next.sort(compareChatsByCreatedAtDesc)
}
