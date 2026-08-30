import type { CodexTurn } from './CodexItemRenderers'

export type CodexThreadHistoryMode = 'legacy' | 'paginated'

export type CodexThreadHistoryMutation =
  | {
      method: 'thread/revert'
      params: {
        threadId: string
        beforeTurnId: string
      }
    }
  | {
      method: 'thread/rollback'
      params: {
        threadId: string
        numTurns: number
      }
    }

export const getCodexEditHistoryMutation = (
  threadId: string,
  historyMode: CodexThreadHistoryMode | undefined,
  beforeTurnId: string,
  numTurns: number
): CodexThreadHistoryMutation =>
  historyMode === 'paginated'
    ? {
        method: 'thread/revert',
        params: { threadId, beforeTurnId }
      }
    : {
        method: 'thread/rollback',
        params: { threadId, numTurns }
      }

export const findCodexUserMessageTurnIndex = (
  turns: readonly Pick<CodexTurn, 'id' | 'items'>[],
  messageId: string
): number => {
  const exactMatchIndex = turns.findIndex((turn) =>
    turn.items.some((item) => item.type === 'userMessage' && `${turn.id}:${item.id}` === messageId)
  )
  if (exactMatchIndex >= 0) return exactMatchIndex

  // Item ids can change when the app-server replaces a local/paginated user-message snapshot
  // with its authoritative item. The renderer id still contains the stable turn id, and editing
  // rolls history back by turn, so use that id when it identifies exactly one user turn.
  const matchingTurnIndexes = turns.flatMap((turn, index) =>
    messageId.startsWith(`${turn.id}:`) && turn.items.some((item) => item.type === 'userMessage')
      ? [index]
      : []
  )

  return matchingTurnIndexes.length === 1 ? matchingTurnIndexes[0] : -1
}
