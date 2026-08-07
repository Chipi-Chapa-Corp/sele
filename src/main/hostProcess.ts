import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir, userInfo } from 'node:os'
import { basename, delimiter, extname, isAbsolute, join } from 'node:path'
import { spawn as spawnPty } from '@lydell/node-pty'
import type { AppContainerTarget, AppContainerTool, AppLocalContainerTarget } from '../shared/app'
import {
  getCurrentContainerHostBridge,
  isCurrentContainerTarget,
  type CurrentContainerHostBridge
} from './currentContainer'
import { getSshEnvironment } from './database/sshEnvironments'
import { getSshCommandArgs } from './sshCommand'
import {
  getRequiredWorkingDirectoryShellLine,
  getTargetTerminalScript,
  quotePosixShellArg
} from './targetShell'

type HostCommandOptions = {
  container?: AppContainerTarget | null
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export type HostCommand = {
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
  'COPILOT_CLI_PATH',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'PATH',
  'SELE_CODEX_PATH',
  'SELE_COPILOT_PATH',
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
const hostBridgeExecutableCache = new Map<string, Promise<string>>()
const commandExecutableCache = new Map<string, Promise<string>>()
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

const getEnvironmentValue = (
  env: NodeJS.ProcessEnv | undefined,
  name: string
): string | undefined => {
  if (!env) return undefined

  const key = Object.keys(env).find((candidate) => candidate.toLocaleLowerCase() === name)
  return key ? env[key] : undefined
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

  const extensions = splitPath(getEnvironmentPathExt(env) ?? '.COM;.EXE;.BAT;.CMD')
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

const quoteFishShellArg = quotePosixShellArg
const quotePowerShellArg = (value: string): string => `'${value.replace(/'/g, "''")}'`
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

const getWindowsPowerShellLookupScript = (commandName: string): string => {
  const quotedCommandName = quotePowerShellArg(commandName)

  return `
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$lookupPath = @(
  $env:Path
  if ($machinePath) { [Environment]::ExpandEnvironmentVariables($machinePath) }
  if ($userPath) { [Environment]::ExpandEnvironmentVariables($userPath) }
) | Where-Object { $_ }
$env:Path = $lookupPath -join ';'
$found = (Get-Command -Name ${quotedCommandName} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Out.WriteLine('')
[Console]::Out.WriteLine('${lookupResultStart}')
[Console]::Out.WriteLine("FOUND=$found")
[Console]::Out.WriteLine("PATH=$($env:Path)")
[Console]::Out.WriteLine('${lookupResultEnd}')
`.trim()
}

const getWindowsPowerShellCandidates = async (env: NodeJS.ProcessEnv): Promise<string[]> => {
  const systemRoot =
    getEnvironmentValue(env, 'systemroot') ??
    getEnvironmentValue(process.env, 'systemroot') ??
    getEnvironmentValue(env, 'windir') ??
    getEnvironmentValue(process.env, 'windir')
  const candidates = unique([
    systemRoot ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null
  ])
  const executableCandidates = await Promise.all(
    candidates.map(async (candidate) => ((await isExecutableFile(candidate)) ? candidate : null))
  )
  return unique(executableCandidates)
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

const resolveFromWindowsPowerShell = async (
  commandName: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv
): Promise<ResolvedHostFile | null> => {
  if (process.platform !== 'win32') return null

  const script = getWindowsPowerShellLookupScript(commandName)
  const powershells = await getWindowsPowerShellCandidates(env)
  for (const powershell of powershells) {
    const result = await runLocalShellLookup(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      env,
      cwd
    )
    if (result && (await isExecutableFile(result.file))) return result
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
      const windowsShellCandidate = await resolveFromWindowsPowerShell(
        file,
        cwd,
        lookupEnvironment.env
      )
      if (windowsShellCandidate) return windowsShellCandidate

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

const getShellEnvironmentAssignments = (env: NodeJS.ProcessEnv | undefined): string[] =>
  Object.entries(getEnvironmentOverrides(env, { skipUnchangedPath: true })).flatMap(
    ([key, value]) => (value == null ? [] : [`${key}=${quotePosixShellArg(value)}`])
  )

const getShellExecLine = (
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  rawTrailingArgs: string[] = []
): string => {
  const environmentAssignments = getShellEnvironmentAssignments(env)
  const command = [...[file, ...args].map(quotePosixShellArg), ...rawTrailingArgs].join(' ')

  return environmentAssignments.length
    ? `exec env ${environmentAssignments.join(' ')} ${command}`
    : `exec ${command}`
}

const getBridgeCommandScript = (
  file: string,
  args: string[],
  options: HostCommandOptions
): string => {
  const lines = [
    ...(options.cwd ? [getRequiredWorkingDirectoryShellLine(options.cwd)] : []),
    getShellExecLine(file, args, options.env)
  ]
  return lines.join('\n')
}

const buildHostBridgeCommand = (
  bridge: CurrentContainerHostBridge,
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): HostCommand => ({
  file: bridge.file,
  args: [...bridge.argsPrefix, 'sh', '-lc', getBridgeCommandScript(file, args, options)],
  env: process.env
})

const containerRuntimeExecutables = {
  distrobox: 'distrobox',
  toolbox: 'toolbox',
  podman: 'podman',
  docker: 'docker'
} satisfies Record<AppContainerTool, string>

type LocalContainerTarget = Extract<AppLocalContainerTarget, { kind: 'container' }>

const getContainerRuntimeExecutable = (container: LocalContainerTarget): string => {
  return containerRuntimeExecutables[container.tool]
}

const getContainerCommandScript = (
  file: string,
  args: string[],
  options: HostCommandOptions
): string => {
  const lines = [
    ...(options.cwd ? [getRequiredWorkingDirectoryShellLine(options.cwd)] : []),
    getShellExecLine(file, args, options.env)
  ]
  return lines.join('\n')
}

const getContainerScriptArgs = (
  container: LocalContainerTarget,
  script: string,
  interactive: boolean
): string[] => {
  if (container.tool === 'distrobox') {
    return ['enter', container.name, '--', 'sh', '-lc', script]
  }
  if (container.tool === 'toolbox') {
    return ['run', '--container', container.name, 'sh', '-lc', script]
  }

  return ['exec', interactive ? '-it' : '-i', container.name, 'sh', '-lc', script]
}

const getContainerExecutableArgs = (
  container: Extract<AppContainerTarget, { tool: AppContainerTool }>,
  file: string,
  args: string[]
): string[] => {
  if (container.tool === 'distrobox') return ['enter', container.name, '--', file, ...args]
  if (container.tool === 'toolbox') return ['run', '--container', container.name, file, ...args]
  return ['exec', '-i', container.name, file, ...args]
}

const getSshHostCommand = async (
  container: Extract<AppContainerTarget, { tool: 'ssh' }>,
  script: string,
  options: { env?: NodeJS.ProcessEnv; interactive?: boolean } = {}
): Promise<HostCommand> => {
  const environment = await getSshEnvironment(container.name)
  if (!environment) throw new Error('SSH environment is no longer available')

  const runtime = container.runtime
  const targetScript =
    runtime?.kind === 'container'
      ? getShellExecLine(
          getContainerRuntimeExecutable(runtime),
          getContainerScriptArgs(runtime, script, Boolean(options.interactive)),
          undefined
        )
      : script
  const args = getSshCommandArgs(environment, targetScript, options.interactive)

  return buildResolvedHostCommand('ssh', args, { env: options.env ?? process.env })
}

const buildResolvedHostCommand = async (
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): Promise<HostCommand> => {
  const bridge = await getCurrentContainerHostBridge()
  if (bridge) return buildHostBridgeCommand(bridge, file, args, options)

  return buildResolvedLocalCommand(file, args, options)
}

const getHostBridgeExecutablePath = async (
  bridge: CurrentContainerHostBridge,
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): Promise<string> => {
  const commandScript = [
    ...(options.cwd ? [getRequiredWorkingDirectoryShellLine(options.cwd)] : []),
    getShellExecLine(file, args, undefined, ['"$@"'])
  ].join('\n')
  const wrapperScript = [
    '#!/bin/sh',
    `exec ${[bridge.file, ...bridge.argsPrefix, 'sh', '-lc', commandScript, 'sele-host-bridge']
      .map(quotePosixShellArg)
      .join(' ')} "$@"`,
    ''
  ].join('\n')
  const hash = createHash('sha256').update(wrapperScript).digest('hex').slice(0, 16)
  const safeFile = basename(file).replace(/[^A-Za-z0-9._-]/g, '_') || 'command'
  const wrapperPath = join(tmpdir(), 'sele-host-bridges', `${safeFile}-${hash}.sh`)
  const existing = hostBridgeExecutableCache.get(wrapperPath)
  if (existing) return existing

  const writePromise = mkdir(join(tmpdir(), 'sele-host-bridges'), { recursive: true })
    .then(() => writeFile(wrapperPath, wrapperScript, { mode: 0o755 }))
    .then(() => chmod(wrapperPath, 0o755))
    .then(() => wrapperPath)
  hostBridgeExecutableCache.set(wrapperPath, writePromise)
  return writePromise
}

const buildHostBridgeExecutableCommand = async (
  bridge: CurrentContainerHostBridge,
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): Promise<HostCommand> => ({
  file: await getHostBridgeExecutablePath(bridge, file, args, options),
  args: [],
  env: await getHostEnvironment(options.env, undefined)
})

const getCommandExecutablePath = async (
  file: string,
  args: string[],
  safeFile: string
): Promise<string> => {
  const wrapperScript = [
    '#!/bin/sh',
    `exec ${[file, ...args].map(quotePosixShellArg).join(' ')} "$@"`,
    ''
  ].join('\n')
  const hash = createHash('sha256').update(wrapperScript).digest('hex').slice(0, 16)
  const safeName = basename(safeFile).replace(/[^A-Za-z0-9._-]/g, '_') || 'command'
  const wrapperPath = join(tmpdir(), 'sele-host-bridges', `${safeName}-${hash}.sh`)
  const existing = commandExecutableCache.get(wrapperPath)
  if (existing) return existing

  const writePromise = mkdir(join(tmpdir(), 'sele-host-bridges'), { recursive: true })
    .then(() => writeFile(wrapperPath, wrapperScript, { mode: 0o755 }))
    .then(() => chmod(wrapperPath, 0o755))
    .then(() => wrapperPath)
  commandExecutableCache.set(wrapperPath, writePromise)
  return writePromise
}

const buildFlatpakExecutableCommand = async (
  command: HostCommand,
  safeFile: string
): Promise<HostCommand> => ({
  file: await getCommandExecutablePath(command.file, command.args, safeFile),
  args: [],
  cwd: command.cwd,
  env: command.env
})

const normalizeWindowsExecutableCommand = (command: HostCommand): HostCommand => {
  if (
    process.platform !== 'win32' ||
    !['.bat', '.cmd'].includes(extname(command.file).toLowerCase())
  ) {
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

const buildResolvedLocalCommand = async (
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): Promise<HostCommand> => {
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

  const flatpakSpawnFile = await resolveHostFile('flatpak-spawn', undefined, process.env).catch(
    () => ({ file: 'flatpak-spawn' })
  )

  return {
    file: flatpakSpawnFile.file,
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

const getContainerRuntimeHostCommand = async (
  container: LocalContainerTarget,
  args: string[],
  options: HostCommandOptions = {}
): Promise<HostCommand> =>
  buildResolvedHostCommand(getContainerRuntimeExecutable(container), args, {
    env: options.env
  })

const getContainerHostCommand = async (
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): Promise<HostCommand> => {
  const container = options.container
  if (!container || container.kind !== 'container')
    return buildResolvedHostCommand(file, args, options)
  if (container.tool === 'ssh') {
    return getSshHostCommand(container, getContainerCommandScript(file, args, options), {
      env: process.env
    })
  }
  if (await isCurrentContainerTarget(container))
    return buildResolvedLocalCommand(file, args, options)

  return getContainerRuntimeHostCommand(
    container,
    getContainerScriptArgs(container, getContainerCommandScript(file, args, options), false),
    options
  )
}

export const getHostCommand = (
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): Promise<HostCommand> => getContainerHostCommand(file, args, options)

export const getHostExecutableCommand = async (
  file: string,
  args: string[],
  options: HostCommandOptions = {}
): Promise<HostCommand> => {
  const normalizeExecutableCommand = (command: HostCommand): Promise<HostCommand> =>
    isRunningInFlatpak()
      ? buildFlatpakExecutableCommand(command, file)
      : Promise.resolve(normalizeWindowsExecutableCommand(command))

  const container = options.container
  if (!container || container.kind !== 'container') {
    const bridge = await getCurrentContainerHostBridge()
    if (bridge) return buildHostBridgeExecutableCommand(bridge, file, args, options)

    return normalizeExecutableCommand(await buildResolvedLocalCommand(file, args, options))
  }
  if (container.tool === 'ssh') {
    return normalizeExecutableCommand(
      await getSshHostCommand(container, getContainerCommandScript(file, args, options), {
        env: process.env
      })
    )
  }
  if (await isCurrentContainerTarget(container))
    return normalizeExecutableCommand(await buildResolvedLocalCommand(file, args, options))

  return normalizeExecutableCommand(
    await getContainerRuntimeHostCommand(
      container,
      getContainerExecutableArgs(container, file, args),
      options
    )
  )
}

export const getHostTerminalCommand = async (options: {
  command?: string | null
  container?: AppContainerTarget | null
  cwd?: string
  env?: NodeJS.ProcessEnv
  keepAlive?: boolean
  shell: { file: string; args: string[] }
}): Promise<HostCommand> => {
  const container = options.container
  if (!container || container.kind !== 'container') {
    return getHostCommand(options.shell.file, options.shell.args, {
      cwd: options.cwd,
      env: options.env
    })
  }
  if (container.tool === 'ssh') {
    return getSshHostCommand(container, getTargetTerminalScript(options), {
      env: process.env,
      interactive: true
    })
  }
  if (await isCurrentContainerTarget(container)) {
    return buildResolvedLocalCommand(options.shell.file, options.shell.args, {
      cwd: options.cwd,
      env: options.env
    })
  }

  return getContainerRuntimeHostCommand(
    container,
    getContainerScriptArgs(container, getTargetTerminalScript(options), true),
    {
      cwd: options.cwd,
      env: options.env
    }
  )
}
