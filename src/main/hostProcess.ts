type HostCommandOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

type HostCommand = {
  file: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

const forwardedEnvironmentVariables = new Set([
  'ALL_PROXY',
  'CODEX_BINARY_PATH',
  'CODEX_HOME',
  'COLORTERM',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'TERM',
  'TERM_PROGRAM',
  'all_proxy',
  'https_proxy',
  'http_proxy',
  'no_proxy'
])

export const isRunningInFlatpak = (): boolean => Boolean(process.env.FLATPAK_ID)

const getEnvironmentArguments = (env: NodeJS.ProcessEnv | undefined): string[] => {
  if (!env) return []

  return Object.entries(env).flatMap(([key, value]) => {
    if (value == null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return []

    const isOverride = value !== process.env[key]
    if (!isOverride && !forwardedEnvironmentVariables.has(key)) return []

    return [`--env=${key}=${value}`]
  })
}

export const getHostCommand = (
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): HostCommand => {
  if (!isRunningInFlatpak()) {
    return {
      file,
      args,
      cwd: options.cwd,
      env: options.env
    }
  }

  return {
    file: 'flatpak-spawn',
    args: [
      '--host',
      '--watch-bus',
      ...(options.cwd ? [`--directory=${options.cwd}`] : []),
      ...getEnvironmentArguments(options.env),
      file,
      ...args
    ],
    env: process.env
  }
}
