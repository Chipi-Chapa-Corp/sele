export const targetWorkingDirectoryFailureExitCode = 125

export const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export const getRequiredWorkingDirectoryShellLine = (cwd: string): string =>
  `cd ${quotePosixShellArg(cwd)} || exit ${targetWorkingDirectoryFailureExitCode}`

export const getTargetTerminalScript = (options: {
  command?: string | null
  cwd?: string
  keepAlive?: boolean
}): string => {
  const command = options.command?.trim() || null
  const lines = [...(options.cwd ? [getRequiredWorkingDirectoryShellLine(options.cwd)] : [])]

  if (!command) {
    lines.push('exec "${SHELL:-/bin/sh}" -l')
    return lines.join('\n')
  }

  lines.push(command)
  if (options.keepAlive) lines.push('exec "${SHELL:-/bin/sh}" -i')
  return lines.join('\n')
}
