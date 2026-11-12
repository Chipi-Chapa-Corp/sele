export const pairedBrowserNames = { chrome: 'Chrome', opera: 'Opera' } as const
export type PairedBrowserId = keyof typeof pairedBrowserNames
export type BrowserConnectionState = {
  connected: boolean
  pairingUrl: string | null
  error: string | null
}
export type DesktopState = {
  computer: {
    connected: boolean
    connecting: boolean
    backend: string | null
    error: string | null
  }
} & Record<PairedBrowserId, BrowserConnectionState>
export type DesktopApi = {
  getState(): Promise<DesktopState>
  connectComputer(): Promise<DesktopState>
  disconnectComputer(): Promise<DesktopState>
  pairChrome(): Promise<DesktopState>
  disconnectChrome(): Promise<DesktopState>
  pairOpera(): Promise<DesktopState>
  disconnectOpera(): Promise<DesktopState>
  openChromeExtension(): Promise<string>
}
export const desktopChannels = {
  getState: 'desktop:get-state',
  connectComputer: 'desktop:connect-computer',
  disconnectComputer: 'desktop:disconnect-computer',
  pairChrome: 'desktop:pair-chrome',
  disconnectChrome: 'desktop:disconnect-chrome',
  pairOpera: 'desktop:pair-opera',
  disconnectOpera: 'desktop:disconnect-opera',
  openChromeExtension: 'desktop:open-chrome-extension'
} as const
