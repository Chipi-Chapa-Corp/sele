export const targetWorkingDirectoryFailureExitCode = 125

export const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export const getStdinSafeLoginShellArgs = (script: string): string[] => [
  'sh',
  '-c',
  // Login profiles may launch programs that read stdin (e.g. host-spawn).
  // Give startup /dev/null, then restore the protocol stream before the command.
  'exec 3<&0; exec sh -lc "$@" </dev/null',
  'sele-login',
  `exec 0<&3 3<&-\n${script}`
]

export const getRequiredWorkingDirectoryShellLine = (cwd: string): string =>
  `cd ${quotePosixShellArg(cwd)} || exit ${targetWorkingDirectoryFailureExitCode}`

export const getTargetTerminalScript = (options: {
  command?: string | null
  cwd?: string
  keepAlive?: boolean
  env?: NodeJS.ProcessEnv
}): string => {
  const command = options.command?.trim() || null
  const lines = [...(options.cwd ? [getRequiredWorkingDirectoryShellLine(options.cwd)] : [])]
  // Container/SSH launchers do not reliably forward arbitrary environment variables.
  for (const key of ['SELE_CHAT_ID', 'SELE_TERMINAL_ID']) {
    const value = options.env?.[key]
    if (value) lines.push(`export ${key}=${quotePosixShellArg(value)}`)
  }

  if (!command) {
    lines.push('exec "${SHELL:-/bin/sh}" -l')
    return lines.join('\n')
  }

  lines.push(command)
  if (options.keepAlive)
    lines.push(
      'printf \'\\033]777;sele-command-finished;%s\\007\' "$?"',
      'exec "${SHELL:-/bin/sh}" -i'
    )
  return lines.join('\n')
}
