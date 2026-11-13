import { execFile } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import type { AppContainerTarget } from '../../../shared/app'
import { isExpectedCommandAbsenceError } from '../../../shared/expectedAbsence.ts'
import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import { getCopilotExecutable } from './CopilotExecutable'

type CopilotProviderUpdateOptions = {
  container?: AppContainerTarget | null
  env?: NodeJS.ProcessEnv
}

type ParsedVersion = {
  major: number
  minor: number
  patch: number
}

const copilotPackageVersionUrl = 'https://registry.npmjs.org/@github%2Fcopilot/latest'
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

const runCopilot = async (
  args: string[],
  timeout: number,
  options: CopilotProviderUpdateOptions
): Promise<string> => {
  const executable = options.container?.kind === 'container' ? 'copilot' : getCopilotExecutable()
  const command = await getHostCommand(executable, args, {
    container: options.container,
    env: options.env
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
        const output = stripVTControlCharacters(`${stdout}\n${stderr}`).trim()
        if (error) {
          // Keep exit codes and interruption details for optional discovery checks.
          error.message = output || error.message
          reject(error)
        } else resolve(output)
      }
    )
    child.stdin?.end()
  })
}

const getCurrentVersion = async (options: CopilotProviderUpdateOptions): Promise<string> => {
  const output = await runCopilot(['--version'], versionCheckTimeoutMs, options)
  const version = parseVersion(output)
  if (!version) throw new Error('Unable to read Copilot version.')
  return version
}

const getLatestVersion = async (): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), versionCheckTimeoutMs)
  try {
    const response = await fetch(copilotPackageVersionUrl, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error('Unable to read Copilot release metadata.')
    const metadata = (await response.json()) as { version?: unknown }
    const version = typeof metadata.version === 'string' ? parseVersion(metadata.version) : null
    if (!version) throw new Error('Unable to read latest Copilot version.')
    return version
  } finally {
    clearTimeout(timeout)
  }
}

export const getCopilotUpdateAvailability = async (
  options: CopilotProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  let currentVersion: string
  try {
    currentVersion = await getCurrentVersion(options)
  } catch (error) {
    if (isExpectedCommandAbsenceError(error)) return null
    throw error
  }
  const latestVersion = await getLatestVersion()
  return compareVersions(currentVersion, latestVersion) < 0
    ? { currentVersion, latestVersion }
    : null
}

export const updateCopilotProvider = async (
  options: CopilotProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const output = await runCopilot(['update'], updateTimeoutMs, options).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/\b(?:EACCES|EPERM)\b|installation directory is not writable/i.test(message)) {
      const environment =
        options.container?.kind === 'container'
          ? `the selected environment (${options.container.name})`
          : 'the host environment'
      throw new Error(
        `Copilot could not update because its installation is not writable in ${environment}. Ask your administrator to update that installation, or reinstall Copilot in a user-writable directory using https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli. Then make sure PATH selects the new executable${options.container?.kind === 'container' ? '' : ' (or set SELE_COPILOT_PATH to it)'} and retry.\n\n${message}`,
        { cause: error }
      )
    }
    throw error
  })
  const remaining = await getCopilotUpdateAvailability(options)
  if (remaining) {
    throw new Error(
      `Copilot update did not complete: version ${remaining.currentVersion} is still installed; ${remaining.latestVersion} is available.${output ? `\n${output}` : ''}`
    )
  }
  return null
}
