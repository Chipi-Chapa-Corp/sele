import { getErrorMessage, shouldAppendExecutableHint } from '../providerValues.ts'

export const openCodeExecutablePathEnvKey = 'SELE_OPENCODE_PATH'

export const getOpenCodeExecutable = (): string => {
  const configuredExecutable = process.env[openCodeExecutablePathEnvKey]?.trim()
  return configuredExecutable || 'opencode'
}

export const getOpenCodeExecutableError = (error: unknown): Error => {
  const configuredExecutable = process.env[openCodeExecutablePathEnvKey]?.trim()
  const message = getErrorMessage(error)
  if (!shouldAppendExecutableHint(message, Boolean(configuredExecutable))) {
    return new Error(message)
  }

  const hint = configuredExecutable
    ? `Check that ${openCodeExecutablePathEnvKey} points to the host OpenCode CLI.`
    : `Install OpenCode on the host or set ${openCodeExecutablePathEnvKey} to its absolute path.`

  return new Error(`${message} ${hint}`)
}
