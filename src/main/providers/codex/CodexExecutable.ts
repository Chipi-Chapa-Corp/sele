export const codexExecutablePathEnvKey = 'SELE_CODEX_PATH'

export const getCodexExecutable = (): string => {
  const configuredExecutable = process.env[codexExecutablePathEnvKey]?.trim()
  return configuredExecutable || 'codex'
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const isCodexExecutableUnavailable = (error: unknown): boolean =>
  ['ENOENT', 'EACCES', 'ENOEXEC'].includes((error as NodeJS.ErrnoException)?.code ?? '') ||
  /Executable was not found|command not found|: (?:not found|No such file or directory|Permission denied)|A coding-agent CLI invocation resolved to Sele itself/i.test(
    getErrorMessage(error)
  )

export const getCodexExecutableError = (error: unknown): Error => {
  const configuredExecutable = process.env[codexExecutablePathEnvKey]?.trim()
  const message = getErrorMessage(error)
  const hint = configuredExecutable
    ? `Check that ${codexExecutablePathEnvKey} points to the host Codex CLI.`
    : `Install the Codex CLI on the host or set ${codexExecutablePathEnvKey} to its absolute path.`
  const needsHint =
    configuredExecutable || isCodexExecutableUnavailable(error) || message.includes('ENOENT')
  return Object.assign(new Error(needsHint ? `${message} ${hint}` : message), {
    code: (error as NodeJS.ErrnoException)?.code
  })
}
