export const shouldKeepClaudeQueryAliveAfterResult = (
  backgroundTaskCount: number,
  terminalReason?: string
): boolean => backgroundTaskCount > 0 || terminalReason === 'background_requested'
