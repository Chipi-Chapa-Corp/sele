import { extname } from 'node:path'

export type WindowsExecutableCommand = {
  file: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

const getEnvironmentValue = (
  env: NodeJS.ProcessEnv | undefined,
  name: string
): string | undefined => {
  if (!env) return undefined

  const key = Object.keys(env).find(
    (candidate) => candidate.toLocaleLowerCase() === name.toLocaleLowerCase()
  )
  return key ? env[key] : undefined
}

export const normalizeWindowsExecutableCommand = (
  command: WindowsExecutableCommand,
  platform: NodeJS.Platform = process.platform
): WindowsExecutableCommand => {
  if (platform !== 'win32' || !['.bat', '.cmd'].includes(extname(command.file).toLowerCase())) {
    return command
  }

  const commandShell =
    getEnvironmentValue(command.env, 'comspec') ??
    getEnvironmentValue(process.env, 'comspec') ??
    'cmd.exe'
  return {
    ...command,
    file: commandShell,
    args: ['/d', '/s', '/c', 'call', command.file, ...command.args]
  }
}
