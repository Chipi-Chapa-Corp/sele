import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, delimiter, extname, isAbsolute, join } from 'node:path'
import { spawn as spawnPty } from '@lydell/node-pty'

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

type ResolvedHostFile = {
  file: string
  path?: string
}

type ShellLookupResult = {
  file: string
  path?: string
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
  'SELE_CODEX_PATH',
  'SELE_DISABLE_CODEX_RESOURCE_ISOLATION',
  'TERM',
  'TERM_PROGRAM',
  'all_proxy',
  'https_proxy',
  'http_proxy',
  'no_proxy'
])

const shellLookupTimeoutMs = 5_000
const shellLookupMaxBuffer = 64 * 1024
const hostEnvironmentTimeoutMs = 5_000
const hostEnvironmentMaxBuffer = 512 * 1024
const resolvedCommandCache = new Map<string, Promise<ResolvedHostFile>>()
let flatpakHostEnvironment: Promise<NodeJS.ProcessEnv> | null = null

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

const getEnvironmentPathKey = (env: NodeJS.ProcessEnv | undefined): string | null => {
  if (!env) return null

  return Object.keys(env).find((key) => key.toLocaleLowerCase() === 'path') ?? null
}

const getEnvironmentPath = (env: NodeJS.ProcessEnv | undefined): string | undefined => {
  const pathKey = getEnvironmentPathKey(env)
  return pathKey ? env?.[pathKey] : undefined
}

const setEnvironmentPath = (
  env: NodeJS.ProcessEnv,
  pathValue: string | undefined
): NodeJS.ProcessEnv => {
  if (pathValue == null) return env

  const pathKey = getEnvironmentPathKey(env) ?? 'PATH'
  return {
    ...env,
    [pathKey]: pathValue
  }
}

const getEnvironmentPathExt = (env: NodeJS.ProcessEnv | undefined): string | undefined => {
  if (!env) return undefined

  const pathExtKey = Object.keys(env).find((key) => key.toLocaleLowerCase() === 'pathext')
  return pathExtKey ? env[pathExtKey] : undefined
}

const parseEnvironment = (value: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}

  for (const entry of value.split('\0')) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex <= 0) continue

    env[entry.slice(0, separatorIndex)] = entry.slice(separatorIndex + 1)
  }

  return env
}

const getFlatpakHostEnvironment = (): Promise<NodeJS.ProcessEnv> => {
  if (!flatpakHostEnvironment) {
    flatpakHostEnvironment = new Promise((resolve) => {
      execFile(
        'flatpak-spawn',
        ['--host', '--watch-bus', 'env', '-0'],
        {
          encoding: 'utf8',
          env: process.env,
          maxBuffer: hostEnvironmentMaxBuffer,
          timeout: hostEnvironmentTimeoutMs
        },
        (error, stdout) => {
          resolve(error ? process.env : parseEnvironment(stdout))
        }
      )
    })
  }

  return flatpakHostEnvironment
}

const getEnvironmentOverrides = (
  env: NodeJS.ProcessEnv | undefined,
  options: { skipUnchangedPath?: boolean } = {}
): NodeJS.ProcessEnv => {
  if (!env) return {}

  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => {
      if (value == null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return []

      const isOverride = value !== process.env[key]
      if (key.toLocaleLowerCase() === 'path' && options.skipUnchangedPath && !isOverride) {
        return []
      }
      if (!isOverride && !forwardedEnvironmentVariables.has(key)) return []

      return [[key, value]]
    })
  )
}

const getLookupEnvironment = async (
  env: NodeJS.ProcessEnv | undefined
): Promise<{ baseEnv: NodeJS.ProcessEnv; env: NodeJS.ProcessEnv }> => {
  if (!isRunningInFlatpak()) {
    return { baseEnv: process.env, env: env ?? process.env }
  }

  const baseEnv = await getFlatpakHostEnvironment()
  const overrides = getEnvironmentOverrides(env, { skipUnchangedPath: true })

  return {
    baseEnv,
    env: {
      ...baseEnv,
      ...overrides
    }
  }
}

const isExecutableFile = async (file: string): Promise<boolean> => {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const getToolPathEntries = (...basePaths: Array<string | undefined>): string[] =>
  unique(basePaths.flatMap(splitPath))

const getCommandNameCandidates = (
  commandName: string,
  env: NodeJS.ProcessEnv | undefined
): string[] => {
  if (process.platform !== 'win32' || extname(commandName)) return [commandName]

  const extensions = splitPath(getEnvironmentPathExt(env))
  return unique([commandName, ...extensions.map((extension) => `${commandName}${extension}`)])
}

const resolveFromPathEntries = async (
  commandName: string,
  pathEntries: string[],
  env: NodeJS.ProcessEnv | undefined
): Promise<string | null> => {
  const commandNameCandidates = getCommandNameCandidates(commandName, env)

  for (const pathEntry of pathEntries) {
    for (const commandNameCandidate of commandNameCandidates) {
      const candidate = join(pathEntry, commandNameCandidate)
      if (await isExecutableFile(candidate)) return candidate
    }
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

const getShellCandidates = async (
  shell: string | undefined = process.env.SHELL,
  checkAccess = true
): Promise<string[]> => {
  const candidates = unique([
    getConfiguredUserShell(),
    shell,
    ...(shell === process.env.SHELL ? [] : [process.env.SHELL])
  ]).filter(isAbsolute)

  if (!checkAccess) return candidates

  const executableCandidates = await Promise.all(
    candidates.map(async (candidate) => ((await isExecutableFile(candidate)) ? candidate : null))
  )
  return unique(executableCandidates)
}

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`
const quoteFishShellArg = quotePosixShellArg
const lookupResultStart = '__SELE_EXECUTABLE_LOOKUP_START__'
const lookupResultEnd = '__SELE_EXECUTABLE_LOOKUP_END__'

const getShellLookupScript = (commandName: string): string => {
  const quotedCommandName = quotePosixShellArg(commandName)

  return `
found="$(command -v ${quotedCommandName} 2>/dev/null || which ${quotedCommandName} 2>/dev/null || true)"
printf '\\n${lookupResultStart}\\nFOUND=%s\\nPATH=%s\\n${lookupResultEnd}\\n' "$found" "$PATH"
`.trim()
}

const getFishLookupScript = (commandName: string): string => {
  const quotedCommandName = quoteFishShellArg(commandName)

  return `
set --local found (command -v ${quotedCommandName} 2>/dev/null; or which ${quotedCommandName} 2>/dev/null)
set --local lookup_path (string join : $PATH)
printf '\\n${lookupResultStart}\\nFOUND=%s\\nPATH=%s\\n${lookupResultEnd}\\n' "$found" "$lookup_path"
`.trim()
}

const getShellLookupArgSets = (
  shell: string,
  commandName: string,
  interactive: boolean
): string[][] => {
  const shellName = basename(shell)
    .toLocaleLowerCase()
    .replace(/\.exe$/, '')

  if (shellName.includes('zsh') || shellName.includes('bash')) {
    const command = getShellLookupScript(commandName)
    return [interactive ? ['-ic', command] : ['-lc', command]]
  }

  if (shellName.includes('fish')) {
    const command = getFishLookupScript(commandName)
    return [interactive ? ['-ic', command] : ['-lc', command]]
  }

  if (['dash', 'ksh', 'mksh', 'sh', 'yash'].includes(shellName)) {
    return [['-c', getShellLookupScript(commandName)]]
  }

  return []
}

const stripTerminalControlSequences = (value: string): string => {
  const escapeCharacter = String.fromCharCode(27)
  const bellCharacter = String.fromCharCode(7)
  let result = ''
  let index = 0

  while (index < value.length) {
    const character = value[index]
    if (character !== escapeCharacter) {
      result += character
      index += 1
      continue
    }

    const nextCharacter = value[index + 1]
    if (!nextCharacter) break

    if (nextCharacter === '[') {
      index += 2
      while (index < value.length) {
        const code = value.charCodeAt(index)
        index += 1
        if (code >= 0x40 && code <= 0x7e) break
      }
      continue
    }

    if (nextCharacter === ']') {
      index += 2
      while (index < value.length) {
        if (value[index] === bellCharacter) {
          index += 1
          break
        }
        if (value[index] === escapeCharacter && value[index + 1] === '\\') {
          index += 2
          break
        }
        index += 1
      }
      continue
    }

    index += 2
  }

  return result
}

const normalizeLookupCandidate = (value: string): string | null => {
  const trimmed = stripTerminalControlSequences(value).trim()
  const normalized = trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed

  return isAbsolute(normalized) ? normalized : null
}

const getLookupResultLines = (stdout: string): string[] => {
  const normalizedOutput = stripTerminalControlSequences(stdout).replace(/\r/g, '\n')
  const startIndex = normalizedOutput.lastIndexOf(lookupResultStart)

  if (startIndex >= 0) {
    const afterStart = normalizedOutput.slice(startIndex + lookupResultStart.length)
    const endIndex = afterStart.indexOf(lookupResultEnd)
    return (endIndex >= 0 ? afterStart.slice(0, endIndex) : afterStart).split('\n')
  }

  return normalizedOutput.split('\n')
}

const parseShellLookupOutput = (stdout: string): ShellLookupResult | null => {
  const lines = getLookupResultLines(stdout)
    .map((line) => line.trim())
    .filter(Boolean)

  const foundLine = lines.find((line) => line.startsWith('FOUND='))
  const pathLine = lines.find((line) => line.startsWith('PATH='))
  const candidate = normalizeLookupCandidate(foundLine?.slice('FOUND='.length) ?? '')
  if (candidate) return { file: candidate, path: pathLine?.slice('PATH='.length) || undefined }

  return null
}

const runLocalShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined
): Promise<ShellLookupResult | null> =>
  new Promise((resolve) => {
    execFile(
      shell,
      args,
      {
        cwd,
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
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  baseEnv?: NodeJS.ProcessEnv
): Promise<ShellLookupResult | null> =>
  new Promise((resolve) => {
    execFile(
      'flatpak-spawn',
      [
        '--host',
        '--watch-bus',
        ...(cwd ? [`--directory=${cwd}`] : []),
        ...getEnvironmentArguments(env, baseEnv),
        shell,
        ...args
      ],
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

const killPty = (pty: ReturnType<typeof spawnPty> | null): void => {
  if (!pty) return

  try {
    pty.kill()
  } catch {
    return
  }
}

const runLocalPtyShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined
): Promise<ShellLookupResult | null> =>
  new Promise((resolve) => {
    let output = ''
    let pty: ReturnType<typeof spawnPty> | null = null
    let settled = false

    const settle = (candidate: ShellLookupResult | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(candidate)
    }

    const timeout = setTimeout(() => {
      killPty(pty)
      settle(null)
    }, shellLookupTimeoutMs)

    try {
      pty = spawnPty(shell, args, {
        cols: 80,
        cwd: cwd ?? homedir(),
        env,
        name: 'xterm-256color',
        rows: 24
      })
    } catch {
      clearTimeout(timeout)
      resolve(null)
      return
    }

    pty.onData((data) => {
      output = `${output}${data}`.slice(-shellLookupMaxBuffer)
    })
    pty.onExit(() => settle(parseShellLookupOutput(output)))
  })

const runFlatpakPtyShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  baseEnv?: NodeJS.ProcessEnv
): Promise<ShellLookupResult | null> =>
  new Promise((resolve) => {
    let output = ''
    let pty: ReturnType<typeof spawnPty> | null = null
    let settled = false

    const settle = (candidate: ShellLookupResult | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(candidate)
    }

    const timeout = setTimeout(() => {
      killPty(pty)
      settle(null)
    }, shellLookupTimeoutMs)

    try {
      pty = spawnPty(
        'flatpak-spawn',
        [
          '--host',
          '--watch-bus',
          ...(cwd ? [`--directory=${cwd}`] : []),
          ...getEnvironmentArguments(env, baseEnv),
          shell,
          ...args
        ],
        {
          cols: 80,
          cwd: homedir(),
          env: process.env,
          name: 'xterm-256color',
          rows: 24
        }
      )
    } catch {
      clearTimeout(timeout)
      resolve(null)
      return
    }

    pty.onData((data) => {
      output = `${output}${data}`.slice(-shellLookupMaxBuffer)
    })
    pty.onExit(() => settle(parseShellLookupOutput(output)))
  })

const runShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  baseEnv?: NodeJS.ProcessEnv
): Promise<ShellLookupResult | null> =>
  isRunningInFlatpak()
    ? runFlatpakShellLookup(shell, args, env, cwd, baseEnv)
    : runLocalShellLookup(shell, args, env, cwd)

const runPtyShellLookup = (
  shell: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  baseEnv?: NodeJS.ProcessEnv
): Promise<ShellLookupResult | null> =>
  isRunningInFlatpak()
    ? runFlatpakPtyShellLookup(shell, args, env, cwd, baseEnv)
    : runLocalPtyShellLookup(shell, args, env, cwd)

const resolveFromShell = async (
  commandName: string,
  pathEntries: string[],
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
  baseEnv?: NodeJS.ProcessEnv
): Promise<ResolvedHostFile | null> => {
  const shells = await getShellCandidates(env.SHELL, !isRunningInFlatpak())
  const lookupPath = pathEntries.join(delimiter)
  const shellEnv = {
    ...env,
    PATH: lookupPath
  }

  for (const shell of shells) {
    for (const args of getShellLookupArgSets(shell, commandName, true)) {
      const result = await runPtyShellLookup(shell, args, shellEnv, cwd, baseEnv)
      if (result && (isRunningInFlatpak() || (await isExecutableFile(result.file)))) {
        return { file: result.file, path: result.path ?? lookupPath }
      }
    }

    for (const args of getShellLookupArgSets(shell, commandName, false)) {
      const result = await runShellLookup(shell, args, shellEnv, cwd, baseEnv)
      if (result && (isRunningInFlatpak() || (await isExecutableFile(result.file)))) {
        return { file: result.file, path: result.path ?? lookupPath }
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
  !isAbsolute(file) && !file.includes('/') && !file.includes('\\')

const getResolveCacheKey = (
  file: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv | undefined
): string =>
  JSON.stringify([
    file,
    cwd ?? null,
    getEnvironmentPath(env) ?? null,
    getEnvironmentPath(process.env) ?? null,
    env?.SHELL ?? process.env.SHELL ?? null
  ])

const resolveHostFile = async (
  file: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<ResolvedHostFile> => {
  if (!shouldResolveWithPath(file)) return { file }

  const cacheKey = getResolveCacheKey(file, cwd, env)
  let resolved = resolvedCommandCache.get(cacheKey)
  if (!resolved) {
    resolved = (async () => {
      const lookupEnvironment = await getLookupEnvironment(env)
      const pathEntries = getToolPathEntries(getEnvironmentPath(lookupEnvironment.env))
      const lookupPath = pathEntries.join(delimiter)
      const shellCandidate = await resolveFromShell(
        file,
        pathEntries,
        cwd,
        lookupEnvironment.env,
        lookupEnvironment.baseEnv
      )
      if (shellCandidate) return shellCandidate

      const pathCandidate = isRunningInFlatpak()
        ? null
        : await resolveFromPathEntries(file, pathEntries, lookupEnvironment.env)
      if (pathCandidate) return { file: pathCandidate, path: lookupPath || undefined }

      throw new Error(getExecutableNotFoundMessage(file))
    })()
    void resolved.catch(() => resolvedCommandCache.delete(cacheKey))
    resolvedCommandCache.set(cacheKey, resolved)
  }

  return resolved
}

const getHostEnvironment = async (
  env: NodeJS.ProcessEnv | undefined,
  path: string | undefined
): Promise<NodeJS.ProcessEnv | undefined> => {
  if (!path && !isRunningInFlatpak()) return env

  const baseEnv = isRunningInFlatpak() ? await getFlatpakHostEnvironment() : (env ?? process.env)
  const overrides = isRunningInFlatpak()
    ? getEnvironmentOverrides(env, { skipUnchangedPath: true })
    : {}

  return setEnvironmentPath(
    {
      ...baseEnv,
      ...overrides
    },
    path ?? getEnvironmentPath({ ...baseEnv, ...overrides })
  )
}

const getEnvironmentArguments = (
  env: NodeJS.ProcessEnv | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env
): string[] => {
  if (!env) return []

  return Object.entries(env).flatMap(([key, value]) => {
    if (value == null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return []

    const isOverride = value !== baseEnv[key]
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
    const resolvedFile = await resolveHostFile(file, options.cwd, options.env)
    const env = await getHostEnvironment(options.env, resolvedFile.path)
    const baseEnv = isRunningInFlatpak() ? await getFlatpakHostEnvironment() : process.env

    if (!isRunningInFlatpak()) {
      return {
        file: resolvedFile.file,
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
        ...getEnvironmentArguments(env, baseEnv),
        resolvedFile.file,
        ...args
      ],
      env: process.env
    }
  }

  return getCommand()
}
