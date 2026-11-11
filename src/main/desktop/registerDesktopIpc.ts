import { app, shell } from 'electron'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { handleLoggedIpc } from '../logging'
import { desktopChannels, type DesktopState } from '../../shared/desktop'
import { computerAutomation } from './ComputerAutomation'
import { chromeAutomation, configureChromePairingStorage } from './ChromeAutomation'
import { startBrowserUseBridge } from '../providers/codex/CodexBrowserBridge'

export const getDesktopState = (): DesktopState => ({
  computer: computerAutomation.status,
  chrome: chromeAutomation.status
})
export function registerDesktopIpc(): void {
  let closeChromeBridge: (() => Promise<void>) | null = null
  configureChromePairingStorage(app.getPath('userData'))
  const ensureBridge = async (): Promise<void> => {
    if (!closeChromeBridge)
      closeChromeBridge = await startBrowserUseBridge(chromeAutomation, {
        type: 'chrome',
        name: 'Chrome (Sele extension)'
      })
  }
  let initialization = chromeAutomation.restore().then(async (restored) => {
    if (restored) await ensureBridge()
  })
  void initialization.catch((error) =>
    console.error('Unable to restore saved Chrome pairing.', error)
  )
  handleLoggedIpc(desktopChannels.getState, async () => {
    await initialization
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
  handleLoggedIpc(desktopChannels.pairChrome, async () => {
    await initialization.catch(() => {}) // Explicit pairing repairs a failed saved binding.
    await chromeAutomation.pair()
    await ensureBridge()
    initialization = Promise.resolve()
    return getDesktopState()
  })
  handleLoggedIpc(desktopChannels.disconnectChrome, async () => {
    await initialization.catch(() => {})
    await chromeAutomation.disconnect()
    initialization = Promise.resolve()
    return getDesktopState()
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
    void chromeAutomation
      .close()
      .catch((error) => console.error('Unable to close Chrome transport.', error))
    void closeChromeBridge?.()
  })
}
