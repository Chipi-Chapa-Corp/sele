import type { ProviderUpdateAvailability } from '../../../shared/provider'
import { getHostCommand } from '../../hostProcess'
import {
  getInstalledProviderUpdateAvailability,
  getLatestProviderVersion,
  joinProviderOutput,
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
    joinProviderOutput
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
  const output = joinProviderOutput(
    await runCopilot(['update'], updateTimeoutMs, options).catch((error: unknown) => {
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
  )
  const remaining = await getCopilotUpdateAvailability(options)
  if (remaining) {
    throw new Error(
      `Copilot update did not complete: version ${remaining.currentVersion} is still installed; ${remaining.latestVersion} is available.${output ? `\n${output}` : ''}`
    )
  }
  return null
}
