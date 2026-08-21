export type ClaudeResultLifecycleDecision = {
  keepQueryAlive: boolean
  waitForSessionIdle: boolean
}

export type ClaudeSessionStateLifecycleDecision = 'ignore' | 'complete'

export const getClaudeResultLifecycleDecision = (
  backgroundTaskCount: number,
  terminalReason?: string,
  forceClose = false
): ClaudeResultLifecycleDecision => {
  const keepQueryAlive =
    !forceClose && (backgroundTaskCount > 0 || terminalReason === 'background_requested')
  return {
    keepQueryAlive,
    waitForSessionIdle: keepQueryAlive
  }
}

export const getClaudeSessionStateLifecycleDecision = (
  waitingForSessionIdle: boolean,
  sessionState: string,
  backgroundTaskCount: number,
  foregroundActive: boolean
): ClaudeSessionStateLifecycleDecision => {
  if (
    !waitingForSessionIdle ||
    sessionState !== 'idle' ||
    backgroundTaskCount > 0 ||
    foregroundActive
  ) {
    return 'ignore'
  }
  return 'complete'
}
