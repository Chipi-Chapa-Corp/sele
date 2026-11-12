import type { ProviderChatTurn } from '../../shared/chatTurns'

// A small saved conversation should appear as a whole. Progressive mounting is
// for expensive histories: making every short turn wait for a paint adds visible
// latency even when parsing and the database read take less than a millisecond.
export const shouldDeferChatHistory = (turns: readonly ProviderChatTurn[]): boolean => {
  if (turns.length > 6) return true
  let items = 0
  let text = 0
  for (const turn of turns) {
    items += turn.items.length
    if (items > 24) return true
    for (const item of turn.items) {
      if (item.type === 'message' || item.type === 'pendingMessage') text += item.content.length
      if (text > 12_000) return true
    }
  }
  return false
}
