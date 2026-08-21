import { execFile } from 'node:child_process'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import { getOpenCodeExecutable, getOpenCodeExecutableError } from './OpenCodeExecutable'

type OpenCodeProviderUpdateOptions = {
  container?: AppContainerTarget | null
  env?: NodeJS.ProcessEnv
}

type ParsedVersion = {
  major: number
  minor: number
  patch: number
}

const openCodePackageVersionUrl = 'https://registry.npmjs.org/opencode-ai/latest'
const commandMaxBuffer = 2 * 1024 * 1024
const versionCheckTimeoutMs = 20_000
const updateTimeoutMs = 10 * 60_000

const parseVersion = (value: string): string | null =>
  /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(value)?.[1] ?? null

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

const runOpenCode = async (
  args: string[],
  timeout: number,
  options: OpenCodeProviderUpdateOptions
): Promise<string> => {
  const executable = options.container?.kind === 'container' ? 'opencode' : getOpenCodeExecutable()
  const command = await getHostCommand(executable, args, {
    container: options.container,
    env: options.env
  }).catch((error: unknown) => {
    throw getOpenCodeExecutableError(error)
  })

  return new Promise((resolve, reject) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        maxBuffer: commandMaxBuffer,
        timeout
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || stdout.trim() || error.message))
        else resolve(`${stdout}\n${stderr}`.trim())
      }
    )
    child.stdin?.end()
  })
}

const getCurrentVersion = async (options: OpenCodeProviderUpdateOptions): Promise<string> => {
  const output = await runOpenCode(['--version'], versionCheckTimeoutMs, options)
  const version = parseVersion(output)
  if (!version) throw new Error('Unable to read OpenCode version.')
  return version
}

const getLatestVersion = async (): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), versionCheckTimeoutMs)
  try {
    const response = await fetch(openCodePackageVersionUrl, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error('Unable to read OpenCode release metadata.')
    const metadata = (await response.json()) as { version?: unknown }
    const version = typeof metadata.version === 'string' ? parseVersion(metadata.version) : null
    if (!version) throw new Error('Unable to read latest OpenCode version.')
    return version
  } finally {
    clearTimeout(timeout)
  }
}

export const getOpenCodeUpdateAvailability = async (
  options: OpenCodeProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const [currentVersion, latestVersion] = await Promise.all([
    getCurrentVersion(options),
    getLatestVersion()
  ])
  return compareVersions(currentVersion, latestVersion) < 0
    ? { currentVersion, latestVersion }
    : null
}

export const updateOpenCodeProvider = async (
  options: OpenCodeProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  await runOpenCode(['upgrade'], updateTimeoutMs, options)
  return getOpenCodeUpdateAvailability(options)
}
