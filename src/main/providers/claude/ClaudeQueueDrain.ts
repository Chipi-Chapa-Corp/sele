export type ClaudeQueueDrainDecision = 'wait' | 'start'

export const getClaudeQueueDrainDecision = (state: {
  hasQueuedMessage: boolean
  paused: boolean
  drainInProgress: boolean
  foregroundActive: boolean
  hasPendingRequest: boolean
}): ClaudeQueueDrainDecision => {
  if (
    !state.hasQueuedMessage ||
    state.paused ||
    state.drainInProgress ||
    state.foregroundActive ||
    state.hasPendingRequest
  ) {
    return 'wait'
  }

  return 'start'
}
