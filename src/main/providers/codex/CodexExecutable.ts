export const codexExecutablePathEnvKey = 'SELE_CODEX_PATH'

export const getCodexExecutable = (): string => {
  const configuredExecutable = process.env[codexExecutablePathEnvKey]?.trim()
  return configuredExecutable || 'codex'
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const shouldAppendExecutableHint = (message: string, hasConfiguredExecutable: boolean): boolean =>
  hasConfiguredExecutable ||
  message.includes('Executable was not found') ||
  message.includes('ENOENT') ||
  message.includes('A coding-agent CLI invocation resolved to Sele itself')

export const getCodexExecutableError = (error: unknown): Error => {
  const configuredExecutable = process.env[codexExecutablePathEnvKey]?.trim()
  const message = getErrorMessage(error)
  if (!shouldAppendExecutableHint(message, Boolean(configuredExecutable))) {
    return new Error(message)
  }

  const hint = configuredExecutable
    ? `Check that ${codexExecutablePathEnvKey} points to the host Codex CLI.`
    : `Install the Codex CLI on the host or set ${codexExecutablePathEnvKey} to its absolute path.`

  return new Error(`${message} ${hint}`)
}
