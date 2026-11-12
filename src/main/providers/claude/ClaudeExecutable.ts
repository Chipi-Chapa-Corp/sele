import { getErrorMessage, shouldAppendExecutableHint } from '../providerValues.ts'

export const claudeExecutablePathEnvKey = 'SELE_CLAUDE_PATH'
export const claudeSdkExecutablePathEnvKey = 'CLAUDE_CODE_EXECUTABLE'

export const getClaudeExecutable = (): string => {
  const configuredExecutable =
    process.env[claudeExecutablePathEnvKey]?.trim() ||
    process.env[claudeSdkExecutablePathEnvKey]?.trim()
  return configuredExecutable || 'claude'
}

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
