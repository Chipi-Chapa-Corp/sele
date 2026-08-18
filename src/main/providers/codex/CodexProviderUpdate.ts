import { execFile } from 'node:child_process'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import { getCodexExecutable, getCodexExecutableError } from './CodexExecutable'

type CommandResult = {
  stdout: string
  stderr: string
}

type ParsedVersion = {
  major: number
  minor: number
  patch: number
}

type NpmPackageVersionResponse = {
  version?: unknown
}

type CodexProviderUpdateOptions = {
  container?: AppContainerTarget | null
  env?: NodeJS.ProcessEnv
}

const codexPackageName = '@openai/codex'
const codexPackageVersionUrl = 'https://registry.npmjs.org/@openai%2Fcodex/latest'
const commandMaxBuffer = 2 * 1024 * 1024
const versionCheckTimeoutMs = 20_000
const updateTimeoutMs = 10 * 60_000

const runCommand = async (
  file: string,
  args: string[],
  timeout: number,
  options: CodexProviderUpdateOptions = {}
): Promise<CommandResult> => {
  const hostCommand = await getHostCommand(file, args, {
    container: options.container,
    env: options.env
  })

  return new Promise((resolve, reject) => {
    const child = execFile(
      hostCommand.file,
      hostCommand.args,
      {
        encoding: 'utf8',
        env: hostCommand.env,
        maxBuffer: commandMaxBuffer,
        timeout
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message
          reject(new Error(message))
          return
        }

        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      }
    )
    child.stdin?.end()
  })
}

const parseVersion = (value: string): string | null => {
  const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(value)
  return match?.[1] ?? null
}

const parseComparableVersion = (version: string): ParsedVersion | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  }
}

const compareVersions = (firstVersion: string, secondVersion: string): number => {
  const first = parseComparableVersion(firstVersion)
  const second = parseComparableVersion(secondVersion)
  if (!first || !second) return firstVersion.localeCompare(secondVersion)

  if (first.major !== second.major) return first.major - second.major
  if (first.minor !== second.minor) return first.minor - second.minor
  return first.patch - second.patch
}

const getCurrentCodexVersion = async (
  options: CodexProviderUpdateOptions = {}
): Promise<string> => {
  const result = await runCommand(
    getCodexExecutable(),
    ['--version'],
    versionCheckTimeoutMs,
    options
  ).catch((error: unknown) => {
    throw getCodexExecutableError(error)
  })
  const version = parseVersion(`${result.stdout}\n${result.stderr}`)
  if (!version) throw new Error('Unable to read Codex version.')

  return version
}

const getLatestCodexVersion = async (): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), versionCheckTimeoutMs)

  try {
    const response = await fetch(codexPackageVersionUrl, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    })

    if (!response.ok) throw new Error(`Unable to read ${codexPackageName} metadata.`)

    const metadata = (await response.json()) as NpmPackageVersionResponse
    const version = typeof metadata.version === 'string' ? parseVersion(metadata.version) : null
    if (!version) throw new Error('Unable to read latest Codex version.')

    return version
  } finally {
    clearTimeout(timeout)
  }
}

const getUpdateAvailability = (
  currentVersion: string,
  latestVersion: string
): ProviderUpdateAvailability | null => {
  if (compareVersions(currentVersion, latestVersion) >= 0) return null

  return {
    currentVersion,
    latestVersion
  }
}

export const getCodexUpdateAvailability = async (
  options: CodexProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const [currentVersion, latestVersion] = await Promise.all([
    getCurrentCodexVersion(options),
    getLatestCodexVersion()
  ])

  return getUpdateAvailability(currentVersion, latestVersion)
}

export const updateCodexProvider = async (
  options: CodexProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  await runCommand(getCodexExecutable(), ['update'], updateTimeoutMs, options).catch(
    (error: unknown) => {
      throw getCodexExecutableError(error)
    }
  )
  return getCodexUpdateAvailability(options)
}
