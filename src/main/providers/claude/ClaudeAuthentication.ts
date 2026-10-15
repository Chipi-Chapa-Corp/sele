/** Claude emits authentication failures as synthetic assistant messages. */
export const isClaudeAuthenticationFailure = (message: {
  type: string
  error?: unknown
  parent_tool_use_id?: unknown
}): boolean =>
  message.type === 'assistant' &&
  !message.parent_tool_use_id &&
  message.error === 'authentication_failed'

export class ClaudeAuthenticationError extends Error {
  readonly code = 'authentication_failed'
}

/** Control/usage requests report errors rather than assistant transcript records. */
export const isClaudeAuthenticationError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { code?: unknown; error?: unknown; status?: unknown; message?: unknown }
  if (record.code === 'authentication_failed' || record.error === 'authentication_failed')
    return true
  if (record.status === 401 || record.status === 403) return true
  return (
    typeof record.message === 'string' &&
    /failed to authenticate|(?:oauth|authentication|access token|session).{0,40}(?:expired|invalid|revoked)|authentication_failed|Claude subscription credentials are unavailable/i.test(
      record.message
    )
  )
}
