export type ClaudeResultLifecycleDecision = {
  keepQueryAlive: boolean
  waitForSessionIdle: boolean
}

export type ClaudeSessionStateLifecycleDecision = 'ignore' | 'complete'

/** SDK API failures may have subtype "success"; is_error owns the success decision. */
export const getClaudeResultError = (result: {
  subtype: string
  is_error?: boolean
  result?: string
  errors?: readonly string[]
}): string | null => {
  if (result.subtype === 'success' && result.is_error !== true) return null
  const reason = result.subtype === 'success' ? 'api_error' : result.subtype
  const content = result.subtype === 'success' ? result.result : result.errors?.join('\n')
  return content?.trim() || `Claude reported ${reason}.`
}

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
