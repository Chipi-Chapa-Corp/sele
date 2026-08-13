export type CodexQueueThreadStatus = 'active' | 'idle' | 'notLoaded' | 'systemError'

export type CodexQueueDrainDecision = 'wait' | 'reconcile' | 'start'

export const getCodexQueueDrainDecision = (state: {
  hasQueuedTurn: boolean
  drainInProgress: boolean
  paused: boolean
  threadStatus: CodexQueueThreadStatus | null
  hasActiveTurn: boolean
  hasPendingApproval: boolean
}): CodexQueueDrainDecision => {
  if (
    !state.hasQueuedTurn ||
    state.drainInProgress ||
    state.paused ||
    state.hasPendingApproval ||
    state.threadStatus !== 'idle'
  ) {
    return 'wait'
  }

  return state.hasActiveTurn ? 'reconcile' : 'start'
}
