import { createRequire } from 'node:module'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { IPty, IPtyForkOptions } from '@lydell/node-pty'
import type { TerminalCreateOptions } from '../shared/terminal'
import type { HostCommand } from './hostProcess'
import { connectProcessRuntime, processRuntimeKey } from './processRuntime'
import source from './terminalRuntime.cjs?raw'

const namespace = 'terminal-runtime-v1'
export type TerminalMetadata = TerminalCreateOptions & { shell: string }
export type PersistentTerminal = Pick<
  IPty,
  'pid' | 'process' | 'write' | 'resize' | 'pause' | 'resume' | 'kill' | 'onExit'
> & {
  metadata: TerminalMetadata
  onData(listener: (data: string, replay?: boolean) => void): { dispose(): void }
  attach(): Promise<void>
  stop(): Promise<void>
  detach(): void
  refreshStatus(): Promise<void>
}

export const connectPersistentTerminal = async (
  profile: string,
  id: string,
  launch?: { command: HostCommand; options: IPtyForkOptions; metadata: TerminalMetadata }
): Promise<PersistentTerminal> => {
  const { initialOutput, ...metadata } = launch?.metadata ?? {}
  const transport = await connectProcessRuntime(profile, id, launch?.command ?? null, {
    namespace,
    source,
    config: launch && {
      ptyModule: createRequire(
        typeof __filename === 'string' ? __filename : import.meta.url
      ).resolve('@lydell/node-pty'),
      ptyOptions: launch.options,
      metadata,
      initialOutput
    }
  })
  let nextId = 0
  let processName = ''
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const data = new Set<(value: string, replay?: boolean) => void>()
  const exits = new Set<(value: { exitCode: number; signal?: number }) => void>()
  const send = (method: string, params?: unknown, id?: number) => {
    if (transport.exitCode !== null) throw new Error('Terminal connection closed.')
    transport.stdin.write(JSON.stringify({ method, params, id }) + '\n')
  }
  const request = <T>(method: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Terminal request timed out.'))
      }, 5000)
      pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      try {
        send(method, undefined, id)
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(error)
      }
    })
  createInterface({ input: transport.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    const entry = pending.get(message.id)
    if (entry) {
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    } else if (message.method === 'data')
      for (const listener of data) listener(message.params, message.replay === true)
    else if (message.method === 'exit') for (const listener of exits) listener(message.params)
  })
  transport.on('error', (error) => console.error('Terminal runtime connection failed.', error))
  transport.on('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Terminal connection closed.'))
    }
    pending.clear()
  })
  try {
    const metadata = await request<TerminalMetadata & { pid: number }>('initialize')
    return {
      metadata,
      pid: metadata.pid,
      get process() {
        return processName
      },
      refreshStatus: async () => {
        processName = (await request<{ process: string }>('status')).process
      },
      attach: () => request('attach'),
      stop: () => request('stop'),
      write: (value) => send('write', value),
      resize: (cols, rows) => send('resize', [cols, rows]),
      // The broker keeps draining output into bounded scrollback on detach.
      pause: () => {},
      resume: () => {},
      kill: () => {
        void request('stop').catch((error) => console.error('Unable to stop terminal.', error))
      },
      detach: () => transport.detach?.(),
      onData: (listener) => {
        data.add(listener)
        return {
          dispose: () => {
            data.delete(listener)
          }
        }
      },
      onExit: (listener) => {
        exits.add(listener)
        return {
          dispose: () => {
            exits.delete(listener)
          }
        }
      }
    }
  } catch (error) {
    transport.detach?.()
    throw error
  }
}

export const listPersistentTerminalIds = async (profile: string): Promise<string[]> => {
  let directories: string[]
  try {
    directories = await readdir(join(profile, namespace))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const ids = await Promise.all(
    directories
      .filter((key) => /^[a-f0-9]{32}$/.test(key))
      .map(async (key) => {
        try {
          const { sessionId } = JSON.parse(
            await readFile(join(profile, namespace, key, 'session.json'), 'utf8')
          )
          return typeof sessionId === 'string' && processRuntimeKey(profile, sessionId) === key
            ? sessionId
            : null
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
      })
  )
  return ids.filter((id): id is string => id !== null)
}
