import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import {
  getLatestProviderVersion,
  getProviderUpdateAvailabilityFromVersions,
  type ProviderUpdateOptions,
  readProviderVersion,
  runProviderCommand,
  updateTimeoutMs,
  versionCheckTimeoutMs
} from '../providerUpdate'
import { getCodexExecutable, getCodexExecutableError } from './CodexExecutable'

// Installation and updates belong to the canonical home, not an account shadow.
const runCodex = (args: string[], timeout: number, options: ProviderUpdateOptions) =>
  getHostCommand(getCodexExecutable(), args, options)
    .then((command) => runProviderCommand(command, timeout, ({ stderr }) => stderr))
    .catch((error: unknown) => {
      throw getCodexExecutableError(error)
    })

export const getCodexUpdateAvailability = async (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const [currentVersion, latestVersion] = await Promise.all([
    runCodex(['--version'], versionCheckTimeoutMs, options).then((output) =>
      readProviderVersion(output, 'Codex')
    ),
    getLatestProviderVersion(
      'https://registry.npmjs.org/@openai%2Fcodex/latest',
      'Codex',
      'Unable to read @openai/codex metadata.'
    )
  ])

  return getProviderUpdateAvailabilityFromVersions(currentVersion, latestVersion)
}

export const updateCodexProvider = async (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  await runCodex(['update'], updateTimeoutMs, options)
  return getCodexUpdateAvailability(options)
}
