import { execFile } from 'node:child_process'
import { shell } from 'electron'
import { getCurrentContainerHostBridge } from './currentContainer'
import { getHostCommand, isRunningInFlatpak } from './hostProcess'
import { getProcessFailureMessage } from './processFailure'

const externalLinkTimeoutMs = 15_000
const desktopEnvironmentKeys = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_TYPE'
] as const

export const openExternalLink = async (url: string): Promise<void> => {
  // Desktop associations inside a container can differ from the user's host desktop.
  if (
    process.platform !== 'linux' ||
    (!isRunningInFlatpak() && !(await getCurrentContainerHostBridge()))
  ) {
    await shell.openExternal(url)
    return
  }

  // The host bridge starts commands with a minimal environment. GUI applications
  // need the display connection from the desktop that launched Sele.
  const desktopEnvironment = desktopEnvironmentKeys.flatMap((key) => {
    // Flatpak's Xauthority file belongs to its sandbox and cannot be used on the host.
    if (key === 'XAUTHORITY' && isRunningInFlatpak()) return []
    const value = process.env[key]
    return value ? [`${key}=${value}`] : []
  })
  const command = await getHostCommand('env', [...desktopEnvironment, 'xdg-open', url])
  await new Promise<void>((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        env: command.env,
        timeout: externalLinkTimeoutMs,
        maxBuffer: 64 * 1024,
        encoding: 'utf8'
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              getProcessFailureMessage(error, stdout, stderr, {
                label: 'Open external link',
                timeoutMs: externalLinkTimeoutMs
              }),
              { cause: error }
            )
          )
          return
        }
        resolve()
      }
    )
  })
}
