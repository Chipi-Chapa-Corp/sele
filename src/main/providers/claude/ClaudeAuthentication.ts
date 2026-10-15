/** Claude emits authentication failures as synthetic assistant messages. */
export const isClaudeAuthenticationFailure = (message: {
  type: string
  error?: unknown
  parent_tool_use_id?: unknown
}): boolean =>
  message.type === 'assistant' &&
  !message.parent_tool_use_id &&
  message.error === 'authentication_failed'
