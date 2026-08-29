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
