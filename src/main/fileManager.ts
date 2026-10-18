import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { shell } from 'electron'
import type { AppContainerTarget } from '../shared/app'
import { getCurrentContainerHostBridge, isCurrentContainerTarget } from './currentContainer'
import { getFileManagerUri, showItemsScript } from './fileManagerScript'
import { getHostCommand, isRunningInFlatpak } from './hostProcess'

const hostHelperTimeoutMs = 30_000

const fileIdentityScript = [
  '[ -e "$1" ] || exit 3',
  'stat -L -c "%d:%i" -- "$1" 2>/dev/null || stat -L -f "%d:%i" -- "$1"'
].join('\n')

const runShell = async (
  container: AppContainerTarget | null | undefined,
  script: string,
  args: string[]
): Promise<string> => {
  const command = await getHostCommand('sh', ['-c', script, 'sele-file-manager', ...args], {
    container,
    env: process.env
  })

  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        timeout: hostHelperTimeoutMs
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }
        resolve(stdout.trim())
      }
    )
  })
}

const getFileIdentity = (
  container: AppContainerTarget | null | undefined,
  absolutePath: string
): Promise<string | null> =>
  runShell(container, fileIdentityScript, [absolutePath]).catch((error: unknown) => {
    console.warn('Unable to inspect a file before showing it in the file manager', error)
    return null
  })

const runsOnHostDirectly = async (): Promise<boolean> =>
  process.platform !== 'linux' ||
  (!isRunningInFlatpak() && !(await getCurrentContainerHostBridge()))

/**
 * Opens the host file manager at `absolutePath`'s folder with the file selected. Paths from a
 * container are shown only when the host sees the same file (as with Toolbx and Distrobox homes).
 */
export const showFileInFileManager = async (
  container: AppContainerTarget | null | undefined,
  absolutePath: string
): Promise<void> => {
  if (container?.kind === 'container' && container.tool === 'ssh') {
    throw new Error('Files on SSH hosts cannot be shown in this computer’s file manager.')
  }

  const hostDirect = await runsOnHostDirectly()
  if (
    container?.kind === 'container' &&
    !(hostDirect && (await isCurrentContainerTarget(container)))
  ) {
    const [targetIdentity, hostIdentity] = await Promise.all([
      getFileIdentity(container, absolutePath),
      getFileIdentity(undefined, absolutePath)
    ])
    if (!targetIdentity) throw new Error('This file no longer exists.')
    if (targetIdentity !== hostIdentity) {
      throw new Error(
        `This file exists only inside the ${container.name} container, ` +
          'so the host file manager cannot show it.'
      )
    }
  }

  if (hostDirect) {
    shell.showItemInFolder(absolutePath)
    return
  }

  await runShell(undefined, showItemsScript, [
    getFileManagerUri(absolutePath),
    dirname(absolutePath)
  ])
}
