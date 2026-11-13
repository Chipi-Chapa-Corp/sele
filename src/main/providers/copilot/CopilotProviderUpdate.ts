import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import {
  getInstalledProviderUpdateAvailability,
  getLatestProviderVersion,
  type ProviderUpdateOptions,
  readProviderVersion,
  runProviderCommand,
  updateTimeoutMs,
  versionCheckTimeoutMs
} from '../providerUpdate'
import { getCopilotExecutable } from './CopilotExecutable'

const runCopilot = async (args: string[], timeout: number, options: ProviderUpdateOptions) =>
  runProviderCommand(
    await getHostCommand(
      options.container?.kind === 'container' ? 'copilot' : getCopilotExecutable(),
      args,
      options
    ),
    timeout,
    ({ stdout, stderr }) => stderr || stdout
  )

export const getCopilotUpdateAvailability = (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> =>
  getInstalledProviderUpdateAvailability(
    async () =>
      readProviderVersion(
        await runCopilot(['--version'], versionCheckTimeoutMs, options),
        'Copilot'
      ),
    () =>
      getLatestProviderVersion(
        'https://registry.npmjs.org/@github%2Fcopilot/latest',
        'Copilot',
        'Unable to read Copilot release metadata.'
      )
  )

export const updateCopilotProvider = async (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  await runCopilot(['update'], updateTimeoutMs, options)
  return getCopilotUpdateAvailability(options)
}
