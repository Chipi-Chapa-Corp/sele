import { execFile } from 'node:child_process'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import { getClaudeExecutable, getClaudeExecutableError } from './ClaudeExecutable'
import { getClaudeUpdateAvailabilityFromVersions, parseClaudeVersion } from './ClaudeVersion'

type CommandResult = {
  stdout: string
  stderr: string
}

type ClaudeReleaseChannel = 'latest' | 'stable'

type ClaudeProviderUpdateOptions = {
  container?: AppContainerTarget | null
  env?: NodeJS.ProcessEnv
}

const claudeReleaseVersionBaseUrl = 'https://downloads.claude.ai/claude-code-releases'
const commandMaxBuffer = 2 * 1024 * 1024
const versionCheckTimeoutMs = 20_000
const updateTimeoutMs = 10 * 60_000

const getExecutable = (options: ClaudeProviderUpdateOptions): string =>
  options.container?.kind === 'container' ? 'claude' : getClaudeExecutable()

const runCommand = async (
  args: string[],
  timeout: number,
  options: ClaudeProviderUpdateOptions = {}
): Promise<CommandResult> => {
  const hostCommand = await getHostCommand(getExecutable(options), args, {
    container: options.container,
    env: options.env
  })

  return new Promise((resolve, reject) => {
    execFile(
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
          reject(new Error(stderr.trim() || stdout.trim() || error.message))
          return
        }

        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      }
    )
  })
}

const getCurrentClaudeVersion = async (
  options: ClaudeProviderUpdateOptions = {}
): Promise<string> => {
  const result = await runCommand(['--version'], versionCheckTimeoutMs, options).catch(
    (error: unknown) => {
      throw getClaudeExecutableError(error)
    }
  )
  const version = parseClaudeVersion(`${result.stdout}\n${result.stderr}`)
  if (!version) throw new Error('Unable to read Claude Code version.')

  return version
}

const getClaudeReleaseChannel = async (
  options: ClaudeProviderUpdateOptions = {}
): Promise<ClaudeReleaseChannel> => {
  const result = await runCommand(['doctor'], versionCheckTimeoutMs, options).catch(() => null)
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  const match = /Auto-update channel:\s*(latest|stable|rc)/i.exec(output)
  return match?.[1]?.toLowerCase() === 'stable' ? 'stable' : 'latest'
}

const getLatestClaudeVersion = async (channel: ClaudeReleaseChannel): Promise<string> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), versionCheckTimeoutMs)

  try {
    const response = await fetch(`${claudeReleaseVersionBaseUrl}/${channel}`, {
      headers: { accept: 'text/plain' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Unable to read Claude Code ${channel} release metadata.`)

    const version = parseClaudeVersion(await response.text())
    if (!version) throw new Error('Unable to read latest Claude Code version.')
    return version
  } finally {
    clearTimeout(timeout)
  }
}

export const getClaudeUpdateAvailability = async (
  options: ClaudeProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const [currentVersion, channel] = await Promise.all([
    getCurrentClaudeVersion(options),
    getClaudeReleaseChannel(options)
  ])
  const latestVersion = await getLatestClaudeVersion(channel)
  return getClaudeUpdateAvailabilityFromVersions(currentVersion, latestVersion)
}

export const updateClaudeProvider = async (
  options: ClaudeProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  await runCommand(['update'], updateTimeoutMs, options).catch((error: unknown) => {
    throw getClaudeExecutableError(error)
  })
  return getClaudeUpdateAvailability(options)
}
