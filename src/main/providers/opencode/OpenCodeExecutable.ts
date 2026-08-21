export const openCodeExecutablePathEnvKey = 'SELE_OPENCODE_PATH'

export const getOpenCodeExecutable = (): string => {
  const configuredExecutable = process.env[openCodeExecutablePathEnvKey]?.trim()
  return configuredExecutable || 'opencode'
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const shouldAppendExecutableHint = (message: string, hasConfiguredExecutable: boolean): boolean =>
  hasConfiguredExecutable ||
  message.includes('Executable was not found') ||
  message.includes('ENOENT') ||
  message.includes('A coding-agent CLI invocation resolved to Sele itself')

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
