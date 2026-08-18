import type { AppSshEnvironment } from '../shared/app'

export const sshConnectTimeoutSeconds = 10

export const getSshCommandArgs = (
  environment: AppSshEnvironment,
  script: string,
  interactive = false
): string[] => [
  interactive ? '-tt' : '-T',
  '-o',
  'BatchMode=yes',
  '-o',
  `ConnectTimeout=${sshConnectTimeoutSeconds}`,
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
  `exec sh -c 'exec sh -lc "$(printf %s "$1" | base64 -d)"' sh '${Buffer.from(script).toString('base64')}'`
]
