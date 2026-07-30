import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'

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
  'CODEX_HOME',
  'COLORTERM',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'PATH',
  'TERM',
  'TERM_PROGRAM',
  'all_proxy',
  'https_proxy',
  'http_proxy',
  'no_proxy'
])

const shellLookupTimeoutMs = 5_000
const shellLookupMaxBuffer = 64 * 1024
const resolvedCommandCache = new Map<string, Promise<string>>()

export const isRunningInFlatpak = (): boolean => Boolean(process.env.FLATPAK_ID)

const unique = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized)) return []

    seen.add(normalized)
    return [normalized]
  })
}

const splitPath = (value: string | undefined): string[] =>
  unique((value ?? '').split(delimiter).filter(Boolean))

const isExecutableFile = async (file: string): Promise<boolean> => {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const getNvmBinEntries = async (homeDirectory: string): Promise<string[]> => {
  const versionsDirectory = join(homeDirectory, '.nvm', 'versions', 'node')
  const entries = await readdir(versionsDirectory, { withFileTypes: true }).catch(() => [])

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(versionsDirectory, entry.name, 'bin'))
    .sort()
    .reverse()
}

const getToolPathEntries = async (basePath: string | undefined): Promise<string[]> => {
  const homeDirectory = homedir()

  return unique([
    ...splitPath(basePath),
    ...splitPath(process.env.PATH),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/local/bin',
    '/home/linuxbrew/.linuxbrew/bin',
    '/snap/bin',
    join(homeDirectory, '.volta', 'bin'),
    join(homeDirectory, '.bun', 'bin'),
    join(homeDirectory, '.deno', 'bin'),
    join(homeDirectory, '.cargo', 'bin'),
    join(homeDirectory, '.local', 'bin'),
    join(homeDirectory, '.npm-global', 'bin'),
    join(homeDirectory, '.npm-packages', 'bin'),
    join(homeDirectory, '.asdf', 'shims'),
    join(homeDirectory, '.local', 'share', 'mise', 'shims'),
    join(homeDirectory, 'Library', 'pnpm'),
    join(homeDirectory, '.local', 'share', 'pnpm'),
    join(homeDirectory, '.nix-profile', 'bin'),
    ...(await getNvmBinEntries(homeDirectory))
  ])
}

const resolveFromPathEntries = async (
  commandName: string,
  pathEntries: string[]
): Promise<string | null> => {
  for (const pathEntry of pathEntries) {
    const candidate = join(pathEntry, commandName)
    if (await isExecutableFile(candidate)) return candidate
  }

  return null
}

const getConfiguredUserShell = (): string | null => {
  try {
    return userInfo().shell
  } catch {
    return null
  }
}

const getShellCandidates = async (checkAccess = true): Promise<string[]> => {
  const candidates = unique([
    getConfiguredUserShell(),
    process.env.SHELL,
    '/bin/zsh',
    '/usr/bin/zsh',
    '/bin/bash',
    '/usr/bin/bash',
    '/bin/fish',
    '/usr/bin/fish',
    '/bin/sh'
  ]).filter(isAbsolute)

  if (!checkAccess) return candidates

  const executableCandidates = await Promise.all(
    candidates.map(async (candidate) => ((await isExecutableFile(candidate)) ? candidate : null))
  )
  return unique(executableCandidates)
}

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

const getShellLookupArgSets = (shell: string, commandName: string): string[][] => {
  const shellName = basename(shell).toLocaleLowerCase()
  const command = `command -v ${quotePosixShellArg(commandName)}`

  if (shellName.includes('zsh') || shellName.includes('bash')) {
    return [
      ['-lc', command],
      ['-lic', command]
    ]
  }

  if (shellName.includes('fish')) {
    return [
      ['-lc', command],
      ['-ic', command]
    ]
  }

  return [['-c', command]]
}

const parseShellLookupOutput = (stdout: string): string | null => {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.find((line) => isAbsolute(line)) ?? null
}

const runLocalShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      shell,
      args,
      {
        encoding: 'utf8',
        env,
        maxBuffer: shellLookupMaxBuffer,
        timeout: shellLookupTimeoutMs
      },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }

        resolve(parseShellLookupOutput(stdout))
      }
    )
  })

const runFlatpakShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      'flatpak-spawn',
      ['--host', '--watch-bus', ...getEnvironmentArguments(env), shell, ...args],
      {
        encoding: 'utf8',
        env: process.env,
        maxBuffer: shellLookupMaxBuffer,
        timeout: shellLookupTimeoutMs
      },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }

        resolve(parseShellLookupOutput(stdout))
      }
    )
  })

const runShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string | null> =>
  isRunningInFlatpak()
    ? runFlatpakShellLookup(shell, args, env)
    : runLocalShellLookup(shell, args, env)

const resolveFromShell = async (
  commandName: string,
  pathEntries: string[]
): Promise<string | null> => {
  const shells = await getShellCandidates(!isRunningInFlatpak())
  const env = {
    ...process.env,
    PATH: pathEntries.join(delimiter)
  }

  for (const shell of shells) {
    for (const args of getShellLookupArgSets(shell, commandName)) {
      const candidate = await runShellLookup(shell, args, env)
      if (candidate && (isRunningInFlatpak() || (await isExecutableFile(candidate)))) {
        return candidate
      }
    }
  }

  return null
}

const getExecutableNotFoundMessage = (file: string): string =>
  [
    `Executable was not found: ${file}.`,
    'Make sure it is available in your shell PATH.',
    'Desktop apps may not inherit your terminal PATH directly.'
  ].join(' ')

const shouldResolveWithPath = (file: string): boolean =>
  (process.platform === 'darwin' || isRunningInFlatpak()) &&
  !isAbsolute(file) &&
  !file.includes('/')

const getResolveCacheKey = (file: string, env: NodeJS.ProcessEnv | undefined): string =>
  JSON.stringify([file, env?.PATH ?? null, process.env.PATH ?? null])

const resolveHostFile = async (
  file: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string> => {
  if (!shouldResolveWithPath(file)) return file

  const cacheKey = getResolveCacheKey(file, env)
  let resolved = resolvedCommandCache.get(cacheKey)
  if (!resolved) {
    resolved = (async () => {
      const pathEntries = await getToolPathEntries(env?.PATH)
      const pathCandidate = isRunningInFlatpak()
        ? null
        : await resolveFromPathEntries(file, pathEntries)
      if (pathCandidate) return pathCandidate

      const shellCandidate = await resolveFromShell(file, pathEntries)
      if (shellCandidate) return shellCandidate

      throw new Error(getExecutableNotFoundMessage(file))
    })()
    void resolved.catch(() => resolvedCommandCache.delete(cacheKey))
    resolvedCommandCache.set(cacheKey, resolved)
  }

  return resolved
}

const getHostEnvironment = async (
  file: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<NodeJS.ProcessEnv | undefined> => {
  if (process.platform !== 'darwin' && !isRunningInFlatpak()) return env

  const baseEnv = env ?? process.env
  const pathEntries = [
    ...(isAbsolute(file) ? [dirname(file)] : []),
    ...(await getToolPathEntries(baseEnv.PATH))
  ]

  return {
    ...baseEnv,
    PATH: unique(pathEntries).join(delimiter)
  }
}

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
): Promise<HostCommand> => {
  const getCommand = async (): Promise<HostCommand> => {
    const resolvedFile = await resolveHostFile(file, options.env)
    const env = await getHostEnvironment(resolvedFile, options.env)

    if (!isRunningInFlatpak()) {
      return {
        file: resolvedFile,
        args,
        cwd: options.cwd,
        env
      }
    }

    return {
      file: 'flatpak-spawn',
      args: [
        '--host',
        '--watch-bus',
        ...(options.cwd ? [`--directory=${options.cwd}`] : []),
        ...getEnvironmentArguments(env),
        resolvedFile,
        ...args
      ],
      env: process.env
    }
  }

  return getCommand()
}
