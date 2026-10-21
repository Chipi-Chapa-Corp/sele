import type { ProviderChatDetail, ProviderChatTurnOutcome } from './provider'
import { getProviderChatTurnCount, startsProviderChatTurn } from './chatTurns.ts'

/** Undefined means this is a history window that cannot describe the latest turn. */
export const getLastTurnOutcome = (
  detail: ProviderChatDetail
): ProviderChatTurnOutcome | null | undefined => {
  // Provider summaries describe the latest native turn independently of the displayed page.
  if (detail.lastTurnOutcome !== undefined) return detail.lastTurnOutcome
  if (detail.turnPagination?.newerCursor) return undefined
  if (
    !detail.turnPagination &&
    detail.turnCount !== undefined &&
    (detail.itemsStartTurnIndex ?? 0) + getProviderChatTurnCount(detail.items) < detail.turnCount
  )
    return undefined

  if (detail.status === 'active' || detail.pendingApproval || detail.pendingUserInput) return null

  for (let index = detail.items.length - 1; index >= 0; index--) {
    const item = detail.items[index]
    // Queued messages have not run and do not resolve the preceding turn.
    if (item.type === 'pendingMessage' || (item.type === 'working' && item.status === 'queued'))
      continue
    if (item.type === 'working') {
      return item.status === 'failed' || item.status === 'stopped' ? item.status : null
    }
    if (startsProviderChatTurn(item)) return detail.status === 'error' ? 'failed' : null
  }
  return detail.status === 'error' ? 'failed' : null
}
