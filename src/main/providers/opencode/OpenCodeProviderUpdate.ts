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
import {
  resolveOpenCodeInstallation,
  clearOpenCodeInstallationCache
} from './OpenCodeInstallations'
import { getOpenCodeExecutableError } from './OpenCodeExecutable'
import { installOpenCode } from './OpenCodeInstall'
import { managedOpenCodeV2Executable } from './OpenCodeInstallations'

const runOpenCode = async (args: string[], timeout: number, options: ProviderUpdateOptions) => {
  const { executable } = await resolveOpenCodeInstallation(options.container)
  const command = await getHostCommand(executable, args, options).catch((error: unknown) => {
    throw getOpenCodeExecutableError(error)
  })
  return runProviderCommand(command, timeout, ({ stdout, stderr }) => stderr || stdout)
}

export const getOpenCodeUpdateAvailability = (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> =>
  getInstalledProviderUpdateAvailability(
    async () =>
      readProviderVersion(
        await runOpenCode(['--version'], versionCheckTimeoutMs, options),
        'OpenCode'
      ),
    () =>
      getLatestProviderVersion(
        'https://registry.npmjs.org/@opencode%2Fcli/latest',
        'OpenCode',
        'Unable to read OpenCode release metadata.'
      )
  )

export const updateOpenCodeProvider = async (
  options: ProviderUpdateOptions = {}
): Promise<ProviderUpdateAvailability | null> => {
  const installation = await resolveOpenCodeInstallation(options.container)
  if (installation.major === 2 && installation.executable === managedOpenCodeV2Executable())
    await installOpenCode(options.container, true)
  else await runOpenCode(['upgrade'], updateTimeoutMs, options)
  clearOpenCodeInstallationCache()
  return getOpenCodeUpdateAvailability(options)
}
