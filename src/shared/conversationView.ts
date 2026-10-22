import type { ProviderChatDetail } from './provider'
import { getProviderChatTurns } from './chatTurns.ts'
import { asChatPreview } from './chatPreview.ts'

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
