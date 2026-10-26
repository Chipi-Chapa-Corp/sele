import type { ProviderChat, ProviderChatDetail } from './provider'
import { getProviderChatTurns, startsProviderChatTurn } from './chatTurns.ts'
import { asChatPreview } from './chatPreview.ts'

/** Sidebar recovery can observe an interruption before the saved viewport is refreshed. */
export const restoreConversationView = (
  view: ProviderChatDetail,
  chat: ProviderChat
): ProviderChatDetail => {
  const restored = asChatPreview({ ...view, ...chat, conversationView: true })
  const outcome = chat.lastTurnOutcome
  if (
    (outcome !== 'stopped' && outcome !== 'failed') ||
    (chat.status !== null && chat.status !== 'error') ||
    !isConversationOpeningDetail({ ...view, historyPreview: false }) ||
    (chat.updatedAt ?? 0) < (view.updatedAt ?? 0)
  )
    return restored

  // Queued prompts have not run. Reconcile only the latest executed turn, leaving
  // historical sections, queue entries, and the durable snapshot itself intact.
  let end = view.items.length
  while (end > 0) {
    const item = view.items[end - 1]
    if (item.type !== 'pendingMessage' && !(item.type === 'working' && item.status === 'queued'))
      break
    end--
  }
  let start = end - 1
  while (start > 0 && !startsProviderChatTurn(view.items[start])) start--
  let changed = false
  const items = view.items.map((item, index) => {
    if (index < start || index >= end || item.type !== 'working' || item.status !== 'working')
      return item
    changed = true
    return { ...item, status: outcome }
  })
  return changed ? { ...restored, items } : restored
}

export const isConversationOpeningDetail = (detail: ProviderChatDetail): boolean =>
  !detail.historyPreview &&
  !detail.turnPagination?.newerCursor &&
  (Boolean(detail.turnPagination) ||
    detail.turnCount === undefined ||
    (detail.itemsStartTurnIndex ?? 0) + getProviderChatTurns(detail.items).length >=
      detail.turnCount)

/** A stable, bounded opening viewport; older pages remain independently pageable. */
export const createConversationView = (detail: ProviderChatDetail): ProviderChatDetail => {
  const turns = getProviderChatTurns(detail.items)
  const latest = turns.at(-1)
  return {
    ...asChatPreview(detail),
    conversationView: true,
    conversationViewSourceRevision: detail.conversationViewSourceRevision ?? detail.revision,
    items: latest?.items ?? [],
    itemsStartTurnIndex: (detail.itemsStartTurnIndex ?? 0) + Math.max(0, turns.length - 1),
    turnCount: detail.turnCount ?? turns.length
  }
}
