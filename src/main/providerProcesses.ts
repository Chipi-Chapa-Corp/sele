import { execFile } from 'node:child_process'
import { app } from 'electron'
import { join } from 'node:path'
import type { AppContainerTarget } from '../shared/app'
import { ProviderProcessStore } from './ProviderProcessStore'
import {
  getHostCommand,
  getHostExecutableCommand,
  resolveHostExecutable,
  type HostCommand
} from './hostProcess'
import { providerProcessContext } from './providerProcessContext'

const execute = async (
  file: string,
  args: string[],
  container: AppContainerTarget | null
): Promise<string> => {
  const command = await getHostCommand(file, args, { container })
  return new Promise((resolve, reject) =>
    execFile(
      command.file,
      command.args,
      { cwd: command.cwd, env: command.env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) =>
        error &&
        !(file === 'systemctl' && args.includes('show') && /^LoadState=not-found$/m.test(stdout))
          ? reject(error)
          : resolve(stdout)
    )
  )
}
let store: ProviderProcessStore | undefined
export const getProviderProcessStore = (): ProviderProcessStore =>
  (store ??= new ProviderProcessStore(
    join(app.getPath('userData'), 'provider-processes-v1'),
    execute
  ))

type Options = { container?: AppContainerTarget | null; cwd?: string; env?: NodeJS.ProcessEnv }
export const getProviderHostCommand = async (
  file: string,
  args: string[],
  options: Options = {}
): Promise<HostCommand> => {
  const scope = providerProcessContext.getStore()
  if (!scope) return getHostCommand(file, args, options)
  const command = await scope.prepare(file, args, options)
  return getHostCommand(command.file, command.args, options)
}
export const getProviderHostExecutableCommand = async (
  file: string,
  args: string[],
  options: Options = {}
): Promise<HostCommand> => {
  if (!providerProcessContext.getStore()) return getHostExecutableCommand(file, args, options)
  const executable = await resolveHostExecutable(file, options)
  return getProviderHostCommand(executable.file, args, { ...options, env: executable.env })
}

let stopGroup: ((id: string) => Promise<void>) | undefined
export const setProviderProcessStopper = (stop: (id: string) => Promise<void>): void => {
  stopGroup = stop
}
export const stopProviderProcessGroup = (id: string): Promise<void> =>
  stopGroup ? stopGroup(id) : getProviderProcessStore().stop(id)
