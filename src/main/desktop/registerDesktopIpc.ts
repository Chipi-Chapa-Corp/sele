import { app, shell } from 'electron'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { handleLoggedIpc } from '../logging'
import {
  desktopChannels,
  pairedBrowserNames,
  type DesktopState,
  type PairedBrowserId
} from '../../shared/desktop'
import { computerAutomation } from './ComputerAutomation'
import { pairedBrowserAutomations, configureChromePairingStorage } from './ChromeAutomation'
import { startBrowserUseBridge } from '../providers/codex/CodexBrowserBridge'

const connectionErrors: Record<PairedBrowserId, string | null> = { chrome: null, opera: null }
export const getDesktopState = (): DesktopState => ({
  computer: computerAutomation.status,
  chrome: { ...pairedBrowserAutomations.chrome.status, error: connectionErrors.chrome },
  opera: { ...pairedBrowserAutomations.opera.status, error: connectionErrors.opera }
})
export function registerDesktopIpc(): void {
  const closeBridges = new Map<PairedBrowserId, () => Promise<void>>()
  configureChromePairingStorage(app.getPath('userData'))
  const ensureBridge = async (id: PairedBrowserId): Promise<void> => {
    if (!closeBridges.has(id)) {
      const close = await startBrowserUseBridge(pairedBrowserAutomations[id], {
        type: 'chrome',
        name: `${pairedBrowserNames[id]} (Sele extension)`,
        ...(id === 'opera' ? { endpointId: 'opera' as const } : {})
      })
      closeBridges.set(id, close)
    }
  }
  // One failed restoration must be visible without disabling the other browser.
  const restore = (id: PairedBrowserId): Promise<void> =>
    pairedBrowserAutomations[id]
      .restore()
      .then(async (restored) => {
        if (restored) await ensureBridge(id)
      })
      .catch((error: unknown) => {
        connectionErrors[id] = error instanceof Error ? error.message : String(error)
        console.error(`Unable to restore saved ${pairedBrowserNames[id]} pairing.`, error)
      })
  const initialization = { chrome: restore('chrome'), opera: restore('opera') }
  handleLoggedIpc(desktopChannels.getState, async () => {
    await Promise.all(Object.values(initialization))
    return getDesktopState()
  })
  handleLoggedIpc(desktopChannels.connectComputer, async () => {
    await computerAutomation.connect()
    return getDesktopState()
  })
  handleLoggedIpc(desktopChannels.disconnectComputer, () => {
    computerAutomation.disconnect()
    return getDesktopState()
  })
  const registerBrowser = (
    id: PairedBrowserId,
    channels: { pair: string; disconnect: string }
  ): void => {
    const change = async (operation: () => Promise<void>): Promise<DesktopState> => {
      await initialization[id]
      try {
        await operation()
        connectionErrors[id] = null
      } catch (error) {
        connectionErrors[id] = error instanceof Error ? error.message : String(error)
        throw error
      }
      return getDesktopState()
    }
    handleLoggedIpc(channels.pair, () =>
      change(async () => {
        await pairedBrowserAutomations[id].pair()
        await ensureBridge(id)
      })
    )
    handleLoggedIpc(channels.disconnect, () =>
      change(() => pairedBrowserAutomations[id].disconnect())
    )
  }
  registerBrowser('chrome', {
    pair: desktopChannels.pairChrome,
    disconnect: desktopChannels.disconnectChrome
  })
  registerBrowser('opera', {
    pair: desktopChannels.pairOpera,
    disconnect: desktopChannels.disconnectOpera
  })
  handleLoggedIpc(desktopChannels.openChromeExtension, async () => {
    const directory = join(app.getPath('userData'), 'sele-chrome-extension')
    await mkdir(directory, { recursive: true })
    await cp(
      join(
        app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'),
        'resources/sele-chrome-extension'
      ),
      directory,
      { recursive: true }
    )
    const error = await shell.openPath(directory)
    if (error) throw new Error(error)
    return directory
  })
  app.once('will-quit', () => {
    computerAutomation.disconnect()
    for (const [id, automation] of Object.entries(pairedBrowserAutomations))
      void automation
        .close()
        .catch((error) => console.error(`Unable to close ${id} transport.`, error))
    for (const close of closeBridges.values()) void close()
  })
}
