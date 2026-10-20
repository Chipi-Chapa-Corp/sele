import { runTargetInput } from './TargetInput'
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { AppContainerTarget } from '../../shared/app'
import type { SeleChatArchive } from '../../shared/chatArchive'
import { getHostCommand, isRunningInFlatpak } from '../hostProcess'
import type { ChatArchiveWorker } from './ChatArchiveWorker'

/** Every file and command belongs to the selected provider runtime, including SSH targets. */
export const createChatImportWorkspace = async (
  localRoot: string,
  id: string,
  container: AppContainerTarget | null
) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid import workspace identifier.')
  const target = container?.kind === 'container' || isRunningInFlatpak()
  const run = async (script: string, args: string[], input?: Buffer): Promise<string> => {
    if (input) return runTargetInput(container, script, args, input)
    const command = await getHostCommand('sh', ['-c', script, 'sele-import', ...args], {
      container
    })
    return new Promise((resolve, reject) => {
      const child = execFile(
        command.file,
        command.args,
        {
          cwd: command.cwd,
          env: command.env,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 120_000
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout))
      )
      child.stdin?.on('error', reject)
      child.stdin?.end(input)
    })
  }
  const directory = target
    ? await run(
        'umask 077; path="$HOME/.local/share/sele/imports/$1"; mkdir -p "$path" && printf %s "$path"',
        [id]
      )
    : join(localRoot, 'imports', id)
  if (
    !directory ||
    (target &&
      (!directory.startsWith('/') ||
        !directory.endsWith(`/sele/imports/${id}`) ||
        /[\r\n]/.test(directory)))
  )
    throw new Error('Unable to create the import workspace.')
  if (!target) await mkdir(directory, { recursive: true, mode: 0o700 })
  return {
    directory,
    restore: async (source: ChatArchiveWorker): Promise<SeleChatArchive> => {
      const attachments = target
        ? posix.join(directory, 'attachments')
        : join(directory, 'attachments')
      const files = {
        mkdir: async (path: string): Promise<void> => {
          if (target) await run('umask 077; mkdir -p "$1"', [path])
          else await mkdir(path, { recursive: true, mode: 0o700 })
        },
        write: async (path: string, data: Buffer): Promise<void> => {
          if (target) await run('umask 077; set -C; cat > "$1"', [path], data)
          else await writeFile(path, data, { mode: 0o600, flag: 'wx' })
        }
      }
      return source.restore(attachments, files)
    },
    remove: async (): Promise<void> => {
      if (target) await run('rm -rf -- "$1"', [directory])
      else await rm(directory, { recursive: true, force: true })
    }
  }
}
