import type { AppContainerTarget } from './app'

export type TerminalCreateOptions = {
  sessionId: string
  cwd?: string | null
  container?: AppContainerTarget | null
  cols: number
  rows: number
  initialCommand?: string | null
  keepAliveOnCommandFinish?: boolean
}

export type TerminalRunCommandOptions = {
  command: string
  cwd?: string | null
  container?: AppContainerTarget | null
}

export type TerminalRunCommandResult = {
  pid: number
}

export type TerminalSession = {
  id: string
  pid: number
  cwd: string
  shell: string
}

export type TerminalDataEvent = {
  sessionId: string
  data: string
}

export type TerminalExitEvent = {
  sessionId: string
  exitCode: number
  signal?: number
}

export type TerminalProcessStatus = {
  hasActiveProcess: boolean
  processName: string | null
}

export type TerminalRendererApi = {
  createSession: (options: TerminalCreateOptions) => Promise<TerminalSession>
  runCommand: (options: TerminalRunCommandOptions) => Promise<TerminalRunCommandResult>
  write: (sessionId: string, data: string) => void
  resize: (sessionId: string, cols: number, rows: number) => void
  setPaused: (sessionId: string, paused: boolean) => void
  getProcessStatus: (sessionId: string) => Promise<TerminalProcessStatus>
  closeSession: (sessionId: string) => Promise<void>
  onData: (listener: (event: TerminalDataEvent) => void) => () => void
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void
}

export const terminalIpcChannels = {
  createSession: 'terminal:create-session',
  runCommand: 'terminal:run-command',
  write: 'terminal:write',
  resize: 'terminal:resize',
  setPaused: 'terminal:set-paused',
  getProcessStatus: 'terminal:get-process-status',
  closeSession: 'terminal:close-session',
  data: 'terminal:data',
  exit: 'terminal:exit'
} as const
