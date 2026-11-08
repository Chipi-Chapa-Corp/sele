import { execFile } from 'node:child_process'
import type { AppContainerTarget } from '../shared/app'
import { getHostCommand } from './hostProcess'
import cleanupSource from './chatProcessCleanup.py?raw'

export const killChatProcesses = async (
  chatIds: string[],
  container: AppContainerTarget | null
): Promise<void> => killOwnedProcesses(chatIds, container, ['SELE_CHAT_ID', 'CODEX_THREAD_ID'])

export const killTerminalProcesses = async (
  sessionIds: string[],
  container: AppContainerTarget | null
): Promise<void> => killOwnedProcesses(sessionIds, container, ['SELE_TERMINAL_ID'])

const killOwnedProcesses = async (
  ids: string[],
  container: AppContainerTarget | null,
  markers: string[]
): Promise<void> => {
  if (!ids.length || (process.platform !== 'linux' && !container)) return
  const command = await getHostCommand(
    'python3',
    ['-c', cleanupSource, JSON.stringify(ids), JSON.stringify(markers)],
    { container }
  )
  await new Promise<void>((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      { cwd: command.cwd, env: command.env, timeout: 15_000, maxBuffer: 64 * 1024 },
      (error) => (error ? reject(error) : resolve())
    )
  })
}
