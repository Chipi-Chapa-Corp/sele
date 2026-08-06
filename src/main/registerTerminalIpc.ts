import { spawn as spawnChildProcess } from 'node:child_process'
import { userInfo } from 'node:os'
import { basename, isAbsolute } from 'node:path'
import { app, ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { spawn as spawnPty } from '@lydell/node-pty'
import type { IDisposable, IPty } from '@lydell/node-pty'
import type {
  TerminalCreateOptions,
  TerminalProcessStatus,
  TerminalRunCommandOptions,
  TerminalRunCommandResult,
  TerminalSession
} from '../shared/terminal'
import { terminalIpcChannels } from '../shared/terminal'
import { requireContainerTarget } from './containerTarget'
import { getHostCommand, getHostTerminalCommand } from './hostProcess'

const minimumColumns = 2
const maximumColumns = 500
const minimumRows = 1
const maximumRows = 300
const outputFlushDelayMs = 4
const maximumOutputBatchCharacters = 64 * 1024
const maximumCommandLength = 20_000

type ManagedTerminalSession = {
  id: string
  owner: WebContents
  pty: IPty
  outputChunks: string[]
  outputCharacters: number
  outputTimer: NodeJS.Timeout | null
  paused: boolean
  shell: string
  dataListener: IDisposable
  exitListener: IDisposable
}

const sessions = new Map<string, ManagedTerminalSession>()
const observedOwners = new Set<number>()

const getDimension = (value: unknown, minimum: number, maximum: number, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid terminal ${name}`)
  }

  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

const getCreateOptions = async (value: unknown): Promise<TerminalCreateOptions> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid terminal options')
  }

  const input = value as {
    sessionId?: unknown
    cwd?: unknown
    cols?: unknown
    rows?: unknown
    initialCommand?: unknown
    keepAliveOnCommandFinish?: unknown
    container?: unknown
  }
  const cwd = input.cwd == null ? app.getPath('home') : input.cwd
  const initialCommand =
    typeof input.initialCommand === 'string' ? input.initialCommand.trim() : null

  if (
    typeof input.sessionId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.sessionId
    )
  ) {
    throw new Error('Invalid terminal session ID')
  }

  if (typeof cwd !== 'string' || !isAbsolute(cwd)) {
    throw new Error('Invalid terminal working directory')
  }

  if (initialCommand && initialCommand.length > maximumCommandLength) {
    throw new Error('Command is too long')
  }

  return {
    sessionId: input.sessionId,
    cwd,
    container: requireContainerTarget(input.container, { optional: true }),
    cols: getDimension(input.cols, minimumColumns, maximumColumns, 'columns'),
    rows: getDimension(input.rows, minimumRows, maximumRows, 'rows'),
    initialCommand,
    keepAliveOnCommandFinish: Boolean(input.keepAliveOnCommandFinish)
  }
}

const getRunCommandOptions = async (value: unknown): Promise<TerminalRunCommandOptions> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid command options')
  }

  const input = value as { command?: unknown; container?: unknown; cwd?: unknown }
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  const cwd = input.cwd == null ? app.getPath('home') : input.cwd

  if (!command) throw new Error('Command is required')
  if (command.length > maximumCommandLength) throw new Error('Command is too long')
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Invalid command cwd')

  return { command, container: requireContainerTarget(input.container, { optional: true }), cwd }
}

const getShell = (): { file: string; args: string[] } => {
  if (process.platform === 'win32') {
    const file = process.env.COMSPEC ?? process.env.ComSpec ?? process.env.SHELL
    if (!file) throw new Error('Unable to determine terminal shell from environment.')

    const shellName = basename(file).toLocaleLowerCase()
    return {
      file,
      args: shellName.includes('powershell') || shellName === 'pwsh.exe' ? ['-NoLogo'] : []
    }
  }

  const configuredUserShell = (() => {
    try {
      return userInfo().shell
    } catch {
      return null
    }
  })()
  const file = [configuredUserShell, process.env.SHELL].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
  )
  if (!file) throw new Error('Unable to determine terminal shell from user or environment.')

  return { file, args: [] }
}

const getCommandShell = (command: string): { file: string; args: string[] } => {
  const shell = getShell()
  const shellName = basename(shell.file).toLocaleLowerCase()

  if (process.platform === 'win32') {
    if (shellName.includes('powershell') || shellName === 'pwsh.exe') {
      return {
        file: shell.file,
        args: [...shell.args, '-NoProfile', '-Command', command]
      }
    }

    return {
      file: shell.file,
      args: ['/d', '/s', '/c', command]
    }
  }

  return {
    file: shell.file,
    args: [...shell.args, '-c', command]
  }
}

const quotePosixShellArg = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

const getTerminalCommandShell = (
  shell: { file: string; args: string[] },
  command: string,
  keepAlive: boolean
): { file: string; args: string[] } => {
  const shellName = basename(shell.file).toLocaleLowerCase()

  if (process.platform === 'win32') {
    if (shellName.includes('powershell') || shellName === 'pwsh.exe') {
      return {
        file: shell.file,
        args: keepAlive
          ? [...shell.args, '-NoExit', '-Command', command]
          : [...shell.args, '-NoProfile', '-Command', command]
      }
    }

    return {
      file: shell.file,
      args: keepAlive ? ['/d', '/s', '/k', command] : ['/d', '/s', '/c', command]
    }
  }

  if (keepAlive && shellName === 'fish') {
    return {
      file: shell.file,
      args: [...shell.args, '-C', command]
    }
  }

  if (keepAlive) {
    return {
      file: shell.file,
      args: [...shell.args, '-i', '-c', `${command}\nexec ${quotePosixShellArg(shell.file)} -i`]
    }
  }

  return {
    file: shell.file,
    args: [...shell.args, '-c', command]
  }
}

const normalizeProcessName = (value: string): string =>
  basename(value.trim())
    .replace(/^-/, '')
    .replace(/\.exe$/i, '')
    .toLocaleLowerCase()

const getProcessStatus = (session: ManagedTerminalSession): TerminalProcessStatus => {
  let processName: string | null = null

  try {
    processName = session.pty.process?.trim() || null
  } catch {
    // Process lookup can race with PTY shutdown.
  }

  const normalizedProcessName = processName ? normalizeProcessName(processName) : null
  const normalizedShellName = normalizeProcessName(session.shell)

  return {
    hasActiveProcess:
      normalizedProcessName !== null &&
      normalizedProcessName !== normalizedShellName &&
      normalizedProcessName !== 'xterm-256color',
    processName
  }
}

const flushOutput = (session: ManagedTerminalSession): void => {
  if (session.outputTimer) {
    clearTimeout(session.outputTimer)
    session.outputTimer = null
  }

  if (session.outputCharacters === 0) return

  const data = session.outputChunks.join('')
  session.outputChunks = []
  session.outputCharacters = 0

  if (!session.owner.isDestroyed()) {
    session.owner.send(terminalIpcChannels.data, {
      sessionId: session.id,
      data
    })
  }
}

const queueOutput = (session: ManagedTerminalSession, data: string): void => {
  session.outputChunks.push(data)
  session.outputCharacters += data.length

  if (session.outputCharacters >= maximumOutputBatchCharacters) {
    flushOutput(session)
    return
  }

  session.outputTimer ??= setTimeout(() => flushOutput(session), outputFlushDelayMs)
}

const disposeSession = (session: ManagedTerminalSession, killProcess: boolean): void => {
  sessions.delete(session.id)

  if (session.outputTimer) {
    clearTimeout(session.outputTimer)
    session.outputTimer = null
  }

  session.dataListener.dispose()
  session.exitListener.dispose()

  if (killProcess) {
    try {
      session.pty.kill()
    } catch {
      // The PTY may already have exited between the lookup and cleanup.
    }
  }
}

const disposeOwnerSessions = (ownerId: number): void => {
  for (const session of sessions.values()) {
    if (session.owner.id === ownerId) disposeSession(session, true)
  }
}

const observeOwner = (owner: WebContents): void => {
  if (observedOwners.has(owner.id)) return
  observedOwners.add(owner.id)

  owner.once('destroyed', () => {
    disposeOwnerSessions(owner.id)
    observedOwners.delete(owner.id)
  })
}

const getOwnedSession = (
  event: IpcMainEvent | IpcMainInvokeEvent,
  sessionId: unknown
): ManagedTerminalSession | null => {
  if (typeof sessionId !== 'string') return null
  const session = sessions.get(sessionId)
  return session?.owner.id === event.sender.id ? session : null
}

const createSession = async (
  event: IpcMainInvokeEvent,
  value: unknown
): Promise<TerminalSession> => {
  const options = await getCreateOptions(value)
  const baseShell = getShell()
  const id = options.sessionId
  if (sessions.has(id)) throw new Error('Terminal session already exists')
  const command = options.initialCommand?.trim() || null
  const shell = command
    ? getTerminalCommandShell(baseShell, command, Boolean(options.keepAliveOnCommandFinish))
    : baseShell
  const cwd = options.cwd ?? app.getPath('home')
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Sele'
  }
  const hostCommand =
    options.container?.kind === 'container'
      ? await getHostTerminalCommand({
          command,
          container: options.container,
          cwd,
          env,
          keepAlive: Boolean(command && options.keepAliveOnCommandFinish),
          shell: baseShell
        })
      : await getHostCommand(shell.file, shell.args, { cwd, env })
  const pty = spawnPty(hostCommand.file, hostCommand.args, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: hostCommand.cwd ?? app.getPath('home'),
    env: hostCommand.env ?? env
  })

  const session: ManagedTerminalSession = {
    id,
    owner: event.sender,
    pty,
    outputChunks: [],
    outputCharacters: 0,
    outputTimer: null,
    paused: false,
    shell: basename(baseShell.file),
    dataListener: { dispose: () => {} },
    exitListener: { dispose: () => {} }
  }

  sessions.set(id, session)
  observeOwner(event.sender)

  session.dataListener = pty.onData((data) => queueOutput(session, data))
  session.exitListener = pty.onExit(({ exitCode, signal }) => {
    flushOutput(session)
    sessions.delete(id)
    session.dataListener.dispose()
    session.exitListener.dispose()

    if (!event.sender.isDestroyed()) {
      event.sender.send(terminalIpcChannels.exit, {
        sessionId: id,
        exitCode,
        ...(signal == null ? {} : { signal })
      })
    }
  })

  return {
    id,
    pid: pty.pid,
    cwd,
    shell: basename(baseShell.file)
  }
}

const runCommand = async (value: unknown): Promise<TerminalRunCommandResult> => {
  const options = await getRunCommandOptions(value)
  const shell = getCommandShell(options.command)
  const cwd = options.cwd ?? app.getPath('home')
  const env = {
    ...process.env,
    TERM_PROGRAM: 'Sele'
  }
  const hostCommand =
    options.container?.kind === 'container'
      ? await getHostCommand('sh', ['-lc', options.command], {
          container: options.container,
          cwd,
          env
        })
      : await getHostCommand(shell.file, shell.args, { cwd, env })
  const child = spawnChildProcess(hostCommand.file, hostCommand.args, {
    cwd: hostCommand.cwd,
    detached: false,
    env: hostCommand.env,
    stdio: 'ignore',
    windowsHide: true
  })
  let settled = false

  return new Promise((resolve, reject) => {
    child.once('error', (error) => {
      if (settled) return

      settled = true
      reject(error)
    })

    setImmediate(() => {
      if (settled) return
      if (typeof child.pid !== 'number') {
        settled = true
        reject(new Error('Unable to start command'))
        return
      }

      settled = true
      child.on('error', () => {})
      child.unref()
      resolve({ pid: child.pid })
    })
  })
}

export const registerTerminalIpc = (): void => {
  ipcMain.handle(terminalIpcChannels.createSession, createSession)
  ipcMain.handle(terminalIpcChannels.runCommand, (_event, value: unknown) => runCommand(value))

  ipcMain.on(terminalIpcChannels.write, (event, sessionId: unknown, data: unknown) => {
    const session = getOwnedSession(event, sessionId)
    if (!session || typeof data !== 'string' || data.length === 0) return
    session.pty.write(data)
  })

  ipcMain.on(
    terminalIpcChannels.resize,
    (event, sessionId: unknown, cols: unknown, rows: unknown) => {
      const session = getOwnedSession(event, sessionId)
      if (!session) return

      try {
        session.pty.resize(
          getDimension(cols, minimumColumns, maximumColumns, 'columns'),
          getDimension(rows, minimumRows, maximumRows, 'rows')
        )
      } catch {
        // Ignore stale resize events racing with PTY exit.
      }
    }
  )

  ipcMain.on(terminalIpcChannels.setPaused, (event, sessionId: unknown, paused: unknown) => {
    const session = getOwnedSession(event, sessionId)
    if (!session || typeof paused !== 'boolean' || session.paused === paused) return

    session.paused = paused
    if (paused) session.pty.pause()
    else session.pty.resume()
  })

  ipcMain.handle(terminalIpcChannels.getProcessStatus, (event, sessionId: unknown) => {
    const session = getOwnedSession(event, sessionId)
    return session ? getProcessStatus(session) : { hasActiveProcess: false, processName: null }
  })

  ipcMain.handle(terminalIpcChannels.closeSession, (event, sessionId: unknown) => {
    const session = getOwnedSession(event, sessionId)
    if (session) disposeSession(session, true)
  })
}

export const disposeTerminalSessions = (): void => {
  for (const session of [...sessions.values()]) disposeSession(session, true)
}
