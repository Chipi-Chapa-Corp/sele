export type TerminalCreateOptions = {
  sessionId: string
  cwd?: string | null
  cols: number
  rows: number
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

export type TerminalRendererApi = {
  createSession: (options: TerminalCreateOptions) => Promise<TerminalSession>
  write: (sessionId: string, data: string) => void
  resize: (sessionId: string, cols: number, rows: number) => void
  setPaused: (sessionId: string, paused: boolean) => void
  closeSession: (sessionId: string) => Promise<void>
  onData: (listener: (event: TerminalDataEvent) => void) => () => void
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void
}

export const terminalIpcChannels = {
  createSession: 'terminal:create-session',
  write: 'terminal:write',
  resize: 'terminal:resize',
  setPaused: 'terminal:set-paused',
  closeSession: 'terminal:close-session',
  data: 'terminal:data',
  exit: 'terminal:exit'
} as const
