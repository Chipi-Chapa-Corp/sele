import { handleClientRequest } from './logging'
import { onClientMessage, type ClientEvent, type RendererClient } from './clientIpc'
import { spawn as spawnChildProcess } from 'node:child_process'
import { userInfo } from 'node:os'
import { basename, isAbsolute } from 'node:path'
import { app } from 'electron'
import { spawnPty } from './pty'
import type { IDisposable, IPty } from '@lydell/node-pty'
import type {
  TerminalCreateOptions,
  TerminalProcessStatus,
  TerminalRunCommandOptions,
  TerminalRunCommandResult,
  TerminalSession,
  TerminalAttachResult
} from '../shared/terminal'
import { terminalIpcChannels } from '../shared/terminal'
import { requireContainerTarget } from './containerTarget'
import { getHostCommand, getHostTerminalCommand } from './hostProcess'
import { agentTerminalSessions } from './agentTerminalSessions'
import {
  connectPersistentTerminal,
  listPersistentTerminalIds,
  type PersistentTerminal
} from './persistentTerminal'
import { providerIds, type ProviderId } from '../shared/provider'
import type { AppContainerTarget } from '../shared/app'
import { killTerminalProcesses } from './chatProcesses'

const minimumColumns = 2
const maximumColumns = 500
const minimumRows = 1
const maximumRows = 300
const outputFlushDelayMs = 4
const maximumOutputBatchCharacters = 64 * 1024
const maximumCommandLength = 20_000
const fishTerminalIntegration = [
  "function __sele_terminal_start --on-event fish_preexec; printf '\\033]133;C\\007'; end",
  "function __sele_terminal_finish --on-event fish_postexec; printf '\\033]133;D;%s\\007' $status; end"
].join('\n')

type ManagedTerminalSession = {
  id: string
  owner: RendererClient
  pty: IPty | PersistentTerminal
  outputChunks: string[]
  outputCharacters: number
  outputTimer: NodeJS.Timeout | null
  paused: boolean
  shell: string
  chatId: string | null
  container: AppContainerTarget | null
  dataListener: IDisposable
  exitListener: IDisposable
}

const sessions = new Map<string, ManagedTerminalSession>()
const pendingTerminalStops = new Set<Promise<void>>()
const pendingTerminalCreates = new Set<Promise<TerminalSession>>()
let shuttingDown = false

const terminalChatId = (chatKey?: string | null): string | null => {
  const separator = chatKey?.indexOf(':') ?? -1
  return separator > 0 ? chatKey!.slice(separator + 1) : null
}

const throwFailures = (results: PromiseSettledResult<unknown>[], message: string): void => {
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      message
    )
}

const stopTerminal = async (
  id: string,
  pty: IPty | PersistentTerminal,
  container: AppContainerTarget | null
): Promise<void> => {
  // Discover descendants before stopping their parent. Container shells are owned
  // by conmon rather than by the local PTY launcher.
  const cleanup = await Promise.allSettled([killTerminalProcesses([id], container)])
  throwFailures(
    [
      ...cleanup,
      ...(await Promise.allSettled([
        'stop' in pty ? pty.stop() : Promise.resolve().then(() => pty.kill())
      ]))
    ],
    'Unable to stop terminal.'
  )
}
const agentAttachments = new Map<
  string,
  { owner: RendererClient; sourceId: string; detach: () => void }
>()
const observedOwners = new Set<number>()

const getDimension = (value: unknown, minimum: number, maximum: number, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid terminal ${name}`)
  }

  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

const getCreateOptions = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid terminal options')
  }

  const input = value as {
    sessionId?: unknown
    cwd?: unknown
    cols?: unknown
    rows?: unknown
    initialCommand?: unknown
    initialOutput?: unknown
    keepAliveOnCommandFinish?: unknown
    workspaceKey?: unknown
    chatKey?: unknown
    label?: unknown
    closeOnCommandFinish?: unknown
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
    initialOutput:
      typeof input.initialOutput === 'string' ? input.initialOutput.slice(-512 * 1024) : undefined,
    keepAliveOnCommandFinish: Boolean(input.keepAliveOnCommandFinish),
    workspaceKey: typeof input.workspaceKey === 'string' ? input.workspaceKey : undefined,
    chatKey: typeof input.chatKey === 'string' ? input.chatKey : null,
    label: typeof input.label === 'string' ? input.label : undefined,
    closeOnCommandFinish: Boolean(input.closeOnCommandFinish)
  } satisfies TerminalCreateOptions
}

const getRunCommandOptions = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid command options')
  }

  const input = value as { command?: unknown; container?: unknown; cwd?: unknown }
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  const cwd = input.cwd == null ? app.getPath('home') : input.cwd

  if (!command) throw new Error('Command is required')
  if (command.length > maximumCommandLength) throw new Error('Command is too long')
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Invalid command cwd')

  return {
    command,
    container: requireContainerTarget(input.container, { optional: true }),
    cwd
  } satisfies TerminalRunCommandOptions
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
    } catch (error) {
      console.error('[caught:registerTerminalIpc:getShell]', error)
      return null
    }
  })()
  const file = [configuredUserShell, process.env.SHELL].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
  )
  if (!file) throw new Error('Unable to determine terminal shell from user or environment.')

  return { file, args: [] }
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
          ? [
              ...shell.args,
              '-NoExit',
              '-Command',
              `${command}\n[Console]::Write(([char]27).ToString() + ']777;sele-command-finished;0' + ([char]7).ToString())`
            ]
          : [...shell.args, '-NoProfile', '-Command', command]
      }
    }

    return {
      file: shell.file,
      args: keepAlive
        ? ['/d', '/s', '/k', `${command}\r\necho \u001b]777;sele-command-finished;0\u0007`]
        : ['/d', '/s', '/c', command]
    }
  }

  if (keepAlive && shellName === 'fish') {
    return {
      file: shell.file,
      args: [
        ...shell.args,
        '-C',
        `${command}\nprintf '\\033]777;sele-command-finished;%s\\007' $status`
      ]
    }
  }

  if (keepAlive) {
    return {
      file: shell.file,
      args: [
        ...shell.args,
        '-i',
        '-c',
        `${command}\nprintf '\\033]777;sele-command-finished;%s\\007' "$?"\nexec ${quotePosixShellArg(shell.file)} -i`
      ]
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
  } catch (error) {
    console.error('[caught:registerTerminalIpc:getProcessStatus]', error)
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

const disposeSession = (session: ManagedTerminalSession, killProcess: boolean): Promise<void> => {
  sessions.delete(session.id)

  if (session.outputTimer) {
    clearTimeout(session.outputTimer)
    session.outputTimer = null
  }

  session.dataListener.dispose()
  session.exitListener.dispose()

  const stopped = (
    killProcess ? stopTerminal(session.id, session.pty, session.container) : Promise.resolve()
  ).finally(() => {
    if ('detach' in session.pty) {
      session.pty.detach()
      knownPersistentTerminals.delete(session.id)
      if (!killProcess) recoveryNeeded = true
    }
  })
  pendingTerminalStops.add(stopped)
  void stopped.finally(() => pendingTerminalStops.delete(stopped)).catch(() => {})
  return stopped
}

const disposeOwnerSessions = (ownerId: number): void => {
  for (const session of sessions.values()) {
    if (session.owner.id === ownerId)
      void disposeSession(session, true).catch((error) =>
        console.error('Unable to stop closed window terminal.', error)
      )
  }
  for (const [id, attachment] of agentAttachments) {
    if (attachment.owner.id !== ownerId) continue
    attachment.detach()
    agentAttachments.delete(id)
  }
}

const observeOwner = (owner: RendererClient): void => {
  if (observedOwners.has(owner.id)) return
  observedOwners.add(owner.id)

  owner.once('destroyed', () => {
    disposeOwnerSessions(owner.id)
    observedOwners.delete(owner.id)
  })
}

const getOwnedSession = (event: ClientEvent, sessionId: unknown): ManagedTerminalSession | null => {
  if (typeof sessionId !== 'string') return null
  const session = sessions.get(sessionId)
  return session?.owner.id === event.sender.id ? session : null
}

const startSession = async (event: ClientEvent, value: unknown): Promise<TerminalSession> => {
  if (shuttingDown) throw new Error('Sele is shutting down.')
  const options = getCreateOptions(value)
  const baseShell = getShell()
  if (basename(baseShell.file) === 'fish') baseShell.args.push('-C', fishTerminalIntegration)
  const id = options.sessionId
  if (sessions.has(id) || agentAttachments.has(id))
    throw new Error('Terminal session already exists')
  const command = options.initialCommand || null
  const shell = command
    ? getTerminalCommandShell(baseShell, command, options.keepAliveOnCommandFinish)
    : baseShell
  const cwd = options.cwd
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Sele',
    SELE_TERMINAL_ID: id
  }
  const chatId = terminalChatId(options.chatKey)
  if (chatId) env.SELE_CHAT_ID = chatId
  else delete env.SELE_CHAT_ID
  if (basename(baseShell.file) === 'bash') {
    env['PS0'] = `\u001b]133;C\u0007${process.env.PS0 ?? ''}`
    env['PROMPT_COMMAND'] = `${process.env.PROMPT_COMMAND ?? ''}\nprintf '\\033]133;D;0\\007'`
  }
  const hostCommand = await getHostTerminalCommand({
    command,
    container: options.container,
    cwd,
    env,
    keepAlive: Boolean(command && options.keepAliveOnCommandFinish),
    shell
  })
  const ptyOptions = {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd: hostCommand.cwd ?? app.getPath('home'),
    env: hostCommand.env ?? env
  }
  const persistent = event.sender.id > 0 && !!options.workspaceKey
  if (persistent) knownPersistentTerminals.add(id)
  const pty = await (persistent
    ? connectPersistentTerminal(app.getPath('userData'), id, {
        command: hostCommand,
        options: ptyOptions,
        metadata: { ...options, shell: basename(baseShell.file) }
      })
    : Promise.resolve(spawnPty(hostCommand.file, hostCommand.args, ptyOptions))
  ).catch((error) => {
    knownPersistentTerminals.delete(id)
    throw error
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
    chatId,
    container: options.container,
    dataListener: { dispose: () => {} },
    exitListener: { dispose: () => {} }
  }

  sessions.set(id, session)
  if (shuttingDown || event.sender.isDestroyed()) {
    await disposeSession(session, true)
    throw new Error('Terminal owner closed during startup.')
  }
  observeOwner(event.sender)

  session.dataListener = pty.onData((data, replay?: boolean) => {
    if (replay) {
      flushOutput(session)
      event.sender.send(terminalIpcChannels.data, { sessionId: id, data, replay: true })
    } else queueOutput(session, data)
  })
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

  if (!persistent && options.initialOutput)
    event.sender.send(terminalIpcChannels.data, {
      sessionId: id,
      data: options.initialOutput,
      replay: true
    })
  if ('attach' in pty) await pty.attach()

  return {
    id,
    pid: pty.pid,
    cwd,
    shell: basename(baseShell.file)
  }
}

const createSession = (event: ClientEvent, value: unknown): Promise<TerminalSession> => {
  const pending = startSession(event, value)
  pendingTerminalCreates.add(pending)
  void pending.finally(() => pendingTerminalCreates.delete(pending)).catch(() => {})
  return pending
}

const runCommand = async (value: unknown): Promise<TerminalRunCommandResult> => {
  const options = getRunCommandOptions(value)
  const shell = getTerminalCommandShell(getShell(), options.command, false)
  const cwd = options.cwd
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

  return new Promise((resolve, reject) => {
    child.once('error', reject)

    setImmediate(() => {
      if (typeof child.pid !== 'number') {
        reject(new Error('Unable to start command'))
        return
      }

      child.on('error', (error) => {
        console.error('[registerTerminalIpc:runDetachedCommand] Detached command error', error)
      })
      child.unref()
      resolve({ pid: child.pid })
    })
  })
}

export const registerTerminalIpc = (): void => {
  handleClientRequest(terminalIpcChannels.listAgentSessions, async () => {
    try {
      await recoverPersistentTerminals()
    } catch {
      // Recovery logs failures once and schedules retries. One unavailable broker
      // must not hide healthy terminals or turn the renderer poll into a log loop.
    }
    return agentTerminalSessions.list()
  })
  handleClientRequest(
    terminalIpcChannels.attachAgentSession,
    (event, sessionId: unknown, sourceId: unknown): TerminalAttachResult => {
      if (
        typeof sessionId !== 'string' ||
        typeof sourceId !== 'string' ||
        sessions.has(sessionId) ||
        agentAttachments.has(sessionId)
      )
        throw new Error('Invalid agent terminal attachment.')
      const owner = event.sender
      if (!agentTerminalSessions.available(sourceId)) {
        const completed = agentTerminalSessions.completed(sourceId)
        if (!completed) return { status: 'unavailable' }
        if (completed.output)
          owner.send(terminalIpcChannels.data, { sessionId, data: completed.output, replay: true })
        owner.send(terminalIpcChannels.exit, { sessionId, exitCode: completed.exitCode })
        return { status: 'exited' }
      }
      observeOwner(owner)
      const detach = agentTerminalSessions.attach(sourceId, {
        data: (data, replay) => {
          if (!owner.isDestroyed())
            owner.send(terminalIpcChannels.data, {
              sessionId,
              data,
              ...(replay ? { replay: true } : {})
            })
        },
        exit: (exitCode) => {
          if (!owner.isDestroyed()) owner.send(terminalIpcChannels.exit, { sessionId, exitCode })
        }
      })
      agentAttachments.set(sessionId, { owner, sourceId, detach })
      return { status: 'attached' }
    }
  )
  handleClientRequest(terminalIpcChannels.stopAgentSession, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid agent terminal ID.')
    return agentTerminalSessions.stop(id)
  })
  handleClientRequest(terminalIpcChannels.dismissAgentSession, (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid agent terminal ID.')
    agentTerminalSessions.dismiss(id)
  })
  handleClientRequest(terminalIpcChannels.createSession, createSession)
  handleClientRequest(terminalIpcChannels.runCommand, (_event, value: unknown) => runCommand(value))

  onClientMessage(terminalIpcChannels.write, (event, sessionId: unknown, data: unknown) => {
    const attachment = typeof sessionId === 'string' ? agentAttachments.get(sessionId) : undefined
    if (attachment?.owner.id === event.sender.id && typeof data === 'string') {
      void agentTerminalSessions
        .write(attachment.sourceId, data)
        .catch((error) => console.error('Unable to write to agent terminal.', error))
      return
    }
    const session = getOwnedSession(event, sessionId)
    if (!session || typeof data !== 'string' || data.length === 0) return
    session.pty.write(data)
  })

  onClientMessage(
    terminalIpcChannels.resize,
    (event, sessionId: unknown, cols: unknown, rows: unknown) => {
      const attachment = typeof sessionId === 'string' ? agentAttachments.get(sessionId) : undefined
      if (attachment?.owner.id === event.sender.id) {
        agentTerminalSessions.resize(
          attachment.sourceId,
          getDimension(cols, minimumColumns, maximumColumns, 'columns'),
          getDimension(rows, minimumRows, maximumRows, 'rows')
        )
        return
      }
      const session = getOwnedSession(event, sessionId)
      if (!session) return

      try {
        session.pty.resize(
          getDimension(cols, minimumColumns, maximumColumns, 'columns'),
          getDimension(rows, minimumRows, maximumRows, 'rows')
        )
      } catch (error) {
        console.error('[caught:registerTerminalIpc:registerTerminalIpc]', error)
        // Ignore stale resize events racing with PTY exit.
      }
    }
  )

  onClientMessage(terminalIpcChannels.setPaused, (event, sessionId: unknown, paused: unknown) => {
    const session = getOwnedSession(event, sessionId)
    if (!session || typeof paused !== 'boolean' || session.paused === paused) return

    session.paused = paused
    if (paused) session.pty.pause()
    else session.pty.resume()
  })

  handleClientRequest(terminalIpcChannels.getProcessStatus, async (event, sessionId: unknown) => {
    const attachment = typeof sessionId === 'string' ? agentAttachments.get(sessionId) : undefined
    if (attachment?.owner.id === event.sender.id)
      return {
        hasActiveProcess: agentTerminalSessions.status(attachment.sourceId) === 'running',
        processName: null
      }
    const session = getOwnedSession(event, sessionId)
    if (session && 'refreshStatus' in session.pty) await session.pty.refreshStatus()
    return session ? getProcessStatus(session) : { hasActiveProcess: false, processName: null }
  })

  handleClientRequest(terminalIpcChannels.closeSession, (event, sessionId: unknown) => {
    const attachment = typeof sessionId === 'string' ? agentAttachments.get(sessionId) : undefined
    if (attachment?.owner.id === event.sender.id) {
      attachment.detach()
      agentAttachments.delete(sessionId as string)
      return
    }
    const session = getOwnedSession(event, sessionId)
    if (session) return disposeSession(session, true)
    return undefined
  })
}

export const disposeTerminalSessions = async (
  options: { preserve?: boolean } = {}
): Promise<void> => {
  if (options.preserve) {
    for (const attachment of agentAttachments.values()) attachment.detach()
    agentAttachments.clear()
    await Promise.all(
      [...sessions.values()].map((session) => disposeSession(session, !('detach' in session.pty)))
    )
    for (const terminal of recoveredPersistentTerminals.values()) terminal.detach()
    recoveredPersistentTerminals.clear()
    recoveryNeeded = true
    return
  }
  shuttingDown = true
  await Promise.allSettled([...pendingTerminalCreates])
  // Include brokers from earlier app instances even when their tabs were never opened.
  const recovered = await Promise.allSettled([recoverPersistentTerminals()])
  for (const attachment of agentAttachments.values()) attachment.detach()
  agentAttachments.clear()
  const stopped = await Promise.allSettled([
    ...pendingTerminalStops,
    ...[...sessions.values()].map((session) => disposeSession(session, true)),
    ...[...recoveredPersistentTerminals].map(([id, terminal]) =>
      stopTerminal(id, terminal, terminal.metadata.container ?? null).finally(() =>
        terminal.detach()
      )
    )
  ])
  recoveredPersistentTerminals.clear()
  throwFailures([...recovered, ...stopped], 'Unable to stop terminals.')
}

export const stopChatTerminalSessions = async (chatIds: string[]): Promise<void> => {
  await recoverPersistentTerminals()
  const ids = new Set(chatIds)
  const results = await Promise.allSettled([
    ...[...sessions.values()]
      .filter((session) => session.chatId && ids.has(session.chatId))
      .map(async (session) => {
        await disposeSession(session, true)
        if (!session.owner.isDestroyed())
          session.owner.send(terminalIpcChannels.exit, { sessionId: session.id, exitCode: 130 })
      }),
    agentTerminalSessions.stopChats(chatIds)
  ])
  throwFailures(results, 'Unable to stop chat terminals.')
}

const knownPersistentTerminals = new Set<string>()
const recoveredPersistentTerminals = new Map<string, PersistentTerminal>()
type RecoveryFailure = { error: unknown; attempts: number; retryAt: number }
const failedTerminalRecoveries = new Map<string, RecoveryFailure>()
let terminalDiscoveryFailure: RecoveryFailure | undefined
const recoveryFailure = (
  previous: RecoveryFailure | undefined,
  error: unknown
): RecoveryFailure => {
  const attempts = (previous?.attempts ?? 0) + 1
  return {
    error,
    attempts,
    retryAt: Date.now() + Math.min(1000 * 2 ** Math.min(attempts - 1, 6), 60000)
  }
}
let recovery: Promise<void> | undefined
let recoveryNeeded = true
const recoverPersistentTerminals = (): Promise<void> => {
  if (recovery) return recovery
  if (!recoveryNeeded) return Promise.resolve()
  recoveryNeeded = false
  recovery = (async () => {
    let ids: string[]
    if (terminalDiscoveryFailure && terminalDiscoveryFailure.retryAt > Date.now())
      throw terminalDiscoveryFailure.error
    try {
      ids = await listPersistentTerminalIds(app.getPath('userData'))
      terminalDiscoveryFailure = undefined
    } catch (error) {
      if (!terminalDiscoveryFailure) console.error('Unable to discover terminal sessions.', error)
      terminalDiscoveryFailure = recoveryFailure(terminalDiscoveryFailure, error)
      throw error
    }
    const available = new Set(ids)
    for (const id of failedTerminalRecoveries.keys())
      if (!available.has(id)) failedTerminalRecoveries.delete(id)
    for (const id of ids) {
      if (knownPersistentTerminals.has(id)) continue
      const previousFailure = failedTerminalRecoveries.get(id)
      if (previousFailure && previousFailure.retryAt > Date.now()) continue
      knownPersistentTerminals.add(id)
      try {
        const terminal = await connectPersistentTerminal(app.getPath('userData'), id)
        failedTerminalRecoveries.delete(id)
        const metadata = terminal.metadata
        if (!metadata.workspaceKey) {
          terminal.detach()
          continue
        }
        const separator = metadata.chatKey?.indexOf(':') ?? -1
        const provider = metadata.chatKey?.slice(0, separator) as ProviderId
        const handle = agentTerminalSessions.register(`workspace:${id}`, {
          providerId: providerIds.includes(provider) ? provider : 'codex',
          chatId: terminalChatId(metadata.chatKey) ?? '',
          chatTitle: metadata.label ?? 'Terminal',
          command: metadata.initialCommand ?? '',
          cwd: metadata.cwd ?? null,
          container: metadata.container ?? null,
          workspaceKey: metadata.workspaceKey,
          workspaceLabel: metadata.label,
          closeOnCommandFinish: metadata.closeOnCommandFinish,
          background: true,
          stop: () =>
            stopTerminal(id, terminal, metadata.container ?? null).finally(() => {
              recoveredPersistentTerminals.delete(id)
              terminal.detach()
            }),
          write: (data) => terminal.write(data),
          resize: (cols, rows) => terminal.resize(cols, rows)
        })
        terminal.onData(handle.append)
        terminal.onExit(({ exitCode }) => {
          void handle.finish(exitCode)
        })
        recoveredPersistentTerminals.set(id, terminal)
        await terminal.attach()
      } catch (error) {
        // Expired helpers are normal; discovery must never relaunch their commands.
        if (
          !['ECONNREFUSED', 'ENOENT', 'ESTALE'].includes(
            (error as NodeJS.ErrnoException).code ?? ''
          )
        ) {
          knownPersistentTerminals.delete(id)
          if (!previousFailure) console.error('Unable to recover terminal session.', id, error)
          failedTerminalRecoveries.set(id, recoveryFailure(previousFailure, error))
        } else {
          failedTerminalRecoveries.delete(id)
        }
      }
    }
    const failures = [...failedTerminalRecoveries.values()].map((failure) => failure.error)
    if (failures.length) throw new AggregateError(failures, 'Unable to recover terminal sessions.')
  })()
    .catch((error) => {
      recoveryNeeded = true
      throw error
    })
    .finally(() => {
      recovery = undefined
    })
  return recovery
}
