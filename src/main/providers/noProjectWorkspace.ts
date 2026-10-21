import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderTurnOptions } from '../../shared/provider'
import { isNoProjectCwd, noProjectWorkspaceDirectory } from '../../shared/noProject'
import { getHostCommand, isRunningInFlatpak } from '../hostProcess'
import { getCurrentContainerHostBridge } from '../currentContainer'

/** Create the workspace on the machine where the provider actually runs. */
export const createNoProjectWorkspace = async (
  localRoot: string,
  container: AppContainerTarget | null | undefined
): Promise<string> => {
  const id = randomUUID()
  if (
    container?.kind !== 'container' &&
    !isRunningInFlatpak() &&
    !(await getCurrentContainerHostBridge())
  ) {
    const directory = join(localRoot, noProjectWorkspaceDirectory, id)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    return directory
  }

  const command = await getHostCommand(
    'sh',
    [
      '-c',
      'umask 077; path="$HOME/.local/share/sele/$1/$2"; mkdir -p "$path" && printf %s "$path"',
      'sele-no-project',
      noProjectWorkspaceDirectory,
      id
    ],
    { container }
  )
  const directory = await new Promise<string>((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      { cwd: command.cwd, env: command.env, encoding: 'utf8', timeout: 30_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
  if (!directory.startsWith('/') || /[\0\r\n]/.test(directory) || !isNoProjectCwd(directory)) {
    throw new Error('Unable to create the general chat workspace.')
  }
  return directory
}

export const prepareChatWorkspace = async (
  localRoot: string,
  options: ProviderTurnOptions | undefined
): Promise<ProviderTurnOptions | undefined> =>
  options?.noProject
    ? {
        ...options,
        cwd: await createNoProjectWorkspace(localRoot, options.container),
        additionalDirectories: undefined
      }
    : options
