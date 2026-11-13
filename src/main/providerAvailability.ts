import { execFile } from 'node:child_process'
import type {
  AppContainerTarget,
  AppSourceAvailability,
  AppSourceAvailabilityOptions
} from '../shared/app'
import type { ProviderId } from '../shared/provider'
import { isExpectedCommandAbsenceError } from '../shared/expectedAbsence.ts'
import { getCurrentContainerHostBridge } from './currentContainer'
import { getHostCommand } from './hostProcess'
import { availabilityFoundMarker, getContainerCommandAvailabilityScript } from './optionalProbe'
import { getCodexExecutable } from './providers/codex/CodexExecutable'
import { getClaudeExecutable } from './providers/claude/ClaudeExecutable'
import { getCopilotExecutable } from './providers/copilot/CopilotExecutable'
import { getOpenCodeInstallations } from './providers/opencode/OpenCodeInstallations'
import { supportsOpenCodeServerContainer } from './providers/opencode/OpenCodeServerClient'

const sourceAvailabilityTimeoutMs = 5_000
// Entering a container (or starting an SSH connection) can outlast a local CLI probe.
const containerAvailabilityTimeoutMs = 30_000
const sourceAvailabilityMaxBuffer = 64 * 1024
const sourceAvailabilityProviderIds = [
  'codex',
  'claude',
  'copilot',
  'opencode-v2'
] as const satisfies readonly ProviderId[]
const sourceAvailabilityCommands = ['git', ...sourceAvailabilityProviderIds] as const

const runAvailabilityCommand = async (
  file: string,
  args: string[],
  container: AppContainerTarget | null | undefined
): Promise<{ success: boolean; stdout: string }> => {
  const hostCommand = await getHostCommand(file, args, {
    container,
    env: process.env
  }).catch((error: unknown) => {
    if (container || !isExpectedCommandAbsenceError(error)) {
      console.warn('Unable to resolve the provider availability command', error)
    }
    return null
  })
  if (!hostCommand) return { success: false, stdout: '' }

  return new Promise((resolve) => {
    try {
      const child = execFile(
        hostCommand.file,
        hostCommand.args,
        {
          cwd: hostCommand.cwd,
          encoding: 'utf8',
          env: hostCommand.env,
          maxBuffer: sourceAvailabilityMaxBuffer,
          timeout:
            container?.kind === 'container'
              ? containerAvailabilityTimeoutMs
              : sourceAvailabilityTimeoutMs
        },
        (error, stdout) => {
          if (error) {
            if (container || !isExpectedCommandAbsenceError(error)) {
              console.warn('Provider availability command failed', error)
            }
          }
          resolve({ success: !error, stdout })
        }
      )
      child.stdin?.end()
    } catch (error) {
      if (container || !isExpectedCommandAbsenceError(error)) {
        console.warn('Unable to start the provider availability command', error)
      }
      resolve({ success: false, stdout: '' })
    }
  })
}

const isCommandAvailableInSource = (
  command: string,
  container: AppContainerTarget | null | undefined
): Promise<boolean> => {
  if (container?.kind === 'container') {
    return runAvailabilityCommand(
      'sh',
      ['-lc', getContainerCommandAvailabilityScript(command)],
      container
    ).then(({ success, stdout }) => success && stdout.includes(availabilityFoundMarker))
  }

  return runAvailabilityCommand(command, ['--version'], null).then(({ success }) => success)
}

export const isProviderAvailableInSource = async (
  providerId: ProviderId,
  container: AppContainerTarget | null | undefined
): Promise<boolean> => {
  if (providerId === 'codex') {
    if (container?.kind === 'container') {
      return isCommandAvailableInSource('codex', container)
    }

    return runAvailabilityCommand(getCodexExecutable(), ['--version'], null).then(
      ({ success }) => success
    )
  }

  if (providerId === 'copilot') {
    if (container?.kind === 'container' || (await getCurrentContainerHostBridge())) {
      return isCommandAvailableInSource('copilot', container)
    }

    return runAvailabilityCommand(getCopilotExecutable(), ['--version'], null).then(
      ({ success }) => success
    )
  }

  if (providerId === 'claude') {
    if (container?.kind === 'container' || (await getCurrentContainerHostBridge())) {
      return isCommandAvailableInSource('claude', container)
    }

    return runAvailabilityCommand(getClaudeExecutable(), ['--version'], null).then(
      ({ success }) => success
    )
  }

  if (providerId === 'opencode-v2') {
    if (!(await supportsOpenCodeServerContainer(container))) return false
    const installations = await getOpenCodeInstallations(container)
    return installations.some((item) => item.major === 2)
  }

  return false
}

export const getSourceAvailability = async (
  options: AppSourceAvailabilityOptions = {}
): Promise<AppSourceAvailability> => {
  const container = options.container
  if (container?.kind === 'container') {
    const script = sourceAvailabilityCommands
      .map(
        (command) => `command -v ${command} >/dev/null 2>&1 && printf '%s\\n' '${command}' || true`
      )
      .join('\n')
    const { stdout } = await runAvailabilityCommand('sh', ['-lc', script], container)
    const availableCommands = new Set(stdout.split('\n').filter(Boolean))
    const openCodeServerSupported = await supportsOpenCodeServerContainer(container)
    const openCodeInstallations = openCodeServerSupported
      ? await getOpenCodeInstallations(container)
      : []

    return {
      gitAvailable: availableCommands.has('git'),
      providers: sourceAvailabilityProviderIds.map((providerId) => ({
        providerId,
        available:
          providerId === 'opencode-v2'
            ? openCodeInstallations.some((item) => item.major === 2)
            : availableCommands.has(providerId)
      }))
    }
  }

  const [gitAvailable, providers] = await Promise.all([
    isCommandAvailableInSource('git', container),
    Promise.all(
      sourceAvailabilityProviderIds.map(async (providerId) => ({
        providerId,
        available: await isProviderAvailableInSource(providerId, container).catch(
          (error: unknown) => {
            console.warn(`Unable to check availability for provider ${providerId}`, error)
            return false
          }
        )
      }))
    )
  ])

  return {
    gitAvailable,
    providers
  }
}
