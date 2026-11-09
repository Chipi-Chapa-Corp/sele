import type { AppContainerTarget } from './app'
import type { ProviderId } from './provider'

export type AgentTerminalSession = {
  id: string
  chatId: string
  providerId: ProviderId
  chatTitle: string
  index: number
  command: string
  cwd: string | null
  container: AppContainerTarget | null
  status: 'running' | 'exited'
  interactive: boolean
  stopScope: 'process' | 'turn'
  workspaceKey?: string
  workspaceLabel?: string
  closeOnCommandFinish?: boolean
}

export type TerminalCreateOptions = {
  sessionId: string
  cwd?: string | null
  container?: AppContainerTarget | null
  cols: number
  rows: number
  initialCommand?: string | null
  /** Scrollback to replay before the new shell's output; never sent to stdin. */
  initialOutput?: string
  keepAliveOnCommandFinish?: boolean
  workspaceKey?: string
  chatKey?: string | null
  label?: string
  closeOnCommandFinish?: boolean
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
  /** Historical output must not generate new replies to the process. */
  replay?: boolean
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

export type TerminalAttachResult = {
  status: 'attached' | 'exited' | 'unavailable'
}

export type TerminalRendererApi = {
  listAgentSessions: () => Promise<AgentTerminalSession[]>
  attachAgentSession: (sessionId: string, agentSessionId: string) => Promise<TerminalAttachResult>
  stopAgentSession: (agentSessionId: string) => Promise<void>
  dismissAgentSession: (agentSessionId: string) => Promise<void>
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
  listAgentSessions: 'terminal:list-agent-sessions',
  attachAgentSession: 'terminal:attach-agent-session',
  stopAgentSession: 'terminal:stop-agent-session',
  dismissAgentSession: 'terminal:dismiss-agent-session',
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
