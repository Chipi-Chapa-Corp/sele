import type { AppSshEnvironment } from '../shared/app'

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export const getSshCommandArgs = (
  environment: AppSshEnvironment,
  script: string,
  interactive = false
): string[] => [
  interactive ? '-tt' : '-T',
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=30',
  '-o',
  'ServerAliveCountMax=3',
  '-o',
  'ClearAllForwardings=yes',
  '-p',
  String(environment.port),
  ...(environment.identityFile ? ['-o', 'IdentitiesOnly=yes', '-i', environment.identityFile] : []),
  ...(environment.user ? ['-l', environment.user] : []),
  environment.host,
  `exec sh -lc ${quotePosixShellArg(script)}`
]
