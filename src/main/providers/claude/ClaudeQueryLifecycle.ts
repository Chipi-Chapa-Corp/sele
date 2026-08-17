export type ClaudeResultLifecycleDecision = {
  keepQueryAlive: boolean
  waitForSessionIdle: boolean
}

export type ClaudeSessionStateLifecycleDecision = 'ignore' | 'complete' | 'sendQueued'

export const getClaudeResultLifecycleDecision = (
  backgroundTaskCount: number,
  terminalReason?: string
): ClaudeResultLifecycleDecision => {
  const keepQueryAlive = backgroundTaskCount > 0 || terminalReason === 'background_requested'
  return {
    keepQueryAlive,
    waitForSessionIdle: keepQueryAlive
  }
}

export const getClaudeSessionStateLifecycleDecision = (
  waitingForSessionIdle: boolean,
  sessionState: string,
  hasQueuedMessage: boolean,
  failed: boolean
): ClaudeSessionStateLifecycleDecision => {
  if (!waitingForSessionIdle || sessionState !== 'idle') return 'ignore'
  return hasQueuedMessage && !failed ? 'sendQueued' : 'complete'
}
