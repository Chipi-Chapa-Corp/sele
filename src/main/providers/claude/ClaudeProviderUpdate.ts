import { stripVTControlCharacters } from 'node:util'
import { isExpectedCommandAbsenceError } from '../../../shared/expectedAbsence.ts'
import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import {
  getLatestProviderVersion,
  getProviderUpdateAvailabilityFromVersions,
  type ProviderCommandOutput,
  type ProviderUpdateOptions,
  readProviderVersion,
  runProviderCommand,
  updateTimeoutMs,
  versionCheckTimeoutMs
} from '../providerUpdate'
import { getClaudeExecutable, getClaudeExecutableError } from './ClaudeExecutable'

type ClaudeReleaseChannel = 'latest' | 'stable'

const joinOutput = ({ stdout, stderr }: ProviderCommandOutput): string =>
  [stdout, stderr].filter(Boolean).join('\n')

const runCommand = async (args: string[], timeout: number, options: ProviderUpdateOptions) =>
  runProviderCommand(
    await getHostCommand(
      options.container?.kind === 'container' ? 'claude' : getClaudeExecutable(),
      args,
      options
    ),
    timeout,
    joinOutput,
    (text) => stripVTControlCharacters(text).trim()
  )

const getClaudeReleaseChannel = async (
  options: ProviderUpdateOptions
): Promise<ClaudeReleaseChannel> => {
  const result = await runCommand(['doctor'], versionCheckTimeoutMs, options).catch(
    (error: unknown) => {
      if (isExpectedCommandAbsenceError(error)) return null
      console.error('Unable to read the Claude release channel.', error)
      return null
    }
  )
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  const match = /Auto-update channel:\s*(latest|stable|rc)/i.exec(output)
  return match?.[1]?.toLowerCase() === 'stable' ? 'stable' : 'latest'
}

export const getClaudeUpdateAvailability = async (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const [currentVersion, channel] = await Promise.all([
    runCommand(['--version'], versionCheckTimeoutMs, options).then(
      (output) => readProviderVersion(output, 'Claude Code'),
      (error: unknown) => {
        throw getClaudeExecutableError(error)
      }
    ),
    getClaudeReleaseChannel(options)
  ])
  const latestVersion = await getLatestProviderVersion(
    `https://downloads.claude.ai/claude-code-releases/${channel}`,
    'Claude Code',
    `Unable to read Claude Code ${channel} release metadata.`,
    'text'
  )
  return getProviderUpdateAvailabilityFromVersions(currentVersion, latestVersion)
}

export const updateClaudeProvider = async (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const output = await runCommand(['update'], updateTimeoutMs, options).catch((error: unknown) => {
    throw getClaudeExecutableError(error)
  })
  const remaining = await getClaudeUpdateAvailability(options)
  if (remaining) {
    const details = joinOutput(output)
    throw new Error(
      `Claude Code update did not complete: version ${remaining.currentVersion} is still installed; ${remaining.latestVersion} is available.${details ? `\n${details}` : '\nRun claude doctor in the selected environment to check the installation.'}`
    )
  }
  return null
}
