export const claudeExecutablePathEnvKey = 'SELE_CLAUDE_PATH'
export const claudeSdkExecutablePathEnvKey = 'CLAUDE_CODE_EXECUTABLE'

export const getClaudeExecutable = (): string => {
  const configuredExecutable =
    process.env[claudeExecutablePathEnvKey]?.trim() ||
    process.env[claudeSdkExecutablePathEnvKey]?.trim()
  return configuredExecutable || 'claude'
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const shouldAppendExecutableHint = (message: string, hasConfiguredExecutable: boolean): boolean =>
  hasConfiguredExecutable ||
  message.includes('Executable was not found') ||
  message.includes('ENOENT') ||
  message.includes('A coding-agent CLI invocation resolved to Sele itself')

export const getClaudeExecutableError = (error: unknown): Error => {
  const configuredExecutable =
    process.env[claudeExecutablePathEnvKey]?.trim() ||
    process.env[claudeSdkExecutablePathEnvKey]?.trim()
  const message = getErrorMessage(error)
  if (!shouldAppendExecutableHint(message, Boolean(configuredExecutable))) {
    return new Error(message)
  }

  const hint = configuredExecutable
    ? `Check that ${claudeExecutablePathEnvKey} or ${claudeSdkExecutablePathEnvKey} points to the host Claude CLI.`
    : `Install Claude Code on the host or set ${claudeExecutablePathEnvKey} to its absolute path.`

  return new Error(`${message} ${hint}`)
}
