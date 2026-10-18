export type DesktopState = {
  computer: {
    connected: boolean
    connecting: boolean
    backend: string | null
    error: string | null
  }
  chrome: { connected: boolean; pairingUrl: string | null }
}
export type DesktopApi = {
  getState(): Promise<DesktopState>
  connectComputer(): Promise<DesktopState>
  disconnectComputer(): Promise<DesktopState>
  pairChrome(): Promise<DesktopState>
  disconnectChrome(): Promise<DesktopState>
  openChromeExtension(): Promise<string>
}
export const desktopChannels = {
  getState: 'desktop:get-state',
  connectComputer: 'desktop:connect-computer',
  disconnectComputer: 'desktop:disconnect-computer',
  pairChrome: 'desktop:pair-chrome',
  disconnectChrome: 'desktop:disconnect-chrome',
  openChromeExtension: 'desktop:open-chrome-extension'
} as const
