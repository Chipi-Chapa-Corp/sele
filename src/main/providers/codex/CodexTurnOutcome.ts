import type { ProviderChatTurnOutcome } from '../../../shared/provider'
import type { CodexTurn } from './CodexItemRenderers'

/** Persisted completions can carry an error even when their status is `completed`. */
export const getCodexTurnOutcome = (
  turn: Pick<CodexTurn, 'status' | 'error'> | null | undefined
): ProviderChatTurnOutcome | null => {
  if (!turn || turn.status === 'inProgress' || turn.status === 'queued') return null
  if (turn.status === 'failed' || turn.error) return 'failed'
  return turn.status === 'interrupted' ? 'stopped' : null
}
