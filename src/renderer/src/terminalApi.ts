import type { TerminalRendererApi } from '../../shared/terminal'

type TerminalWindow = Window & {
  terminalApi: TerminalRendererApi
}

export const terminalApi = (window as unknown as TerminalWindow).terminalApi
