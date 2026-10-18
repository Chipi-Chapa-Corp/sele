import { app, shell } from 'electron'
import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { handleLoggedIpc } from '../logging'
import { desktopChannels, type DesktopState } from '../../shared/desktop'
import { computerAutomation } from './ComputerAutomation'
import { chromeAutomation } from './ChromeAutomation'
import { startBrowserUseBridge } from '../providers/codex/CodexBrowserBridge'

export const getDesktopState = (): DesktopState => ({
  computer: computerAutomation.status,
  chrome: chromeAutomation.status
})
export function registerDesktopIpc(): void {
  let closeChromeBridge: (() => Promise<void>) | null = null
  handleLoggedIpc(desktopChannels.getState, () => getDesktopState())
  handleLoggedIpc(desktopChannels.connectComputer, async () => {
    await computerAutomation.connect()
    return getDesktopState()
  })
  handleLoggedIpc(desktopChannels.disconnectComputer, () => {
    computerAutomation.disconnect()
    return getDesktopState()
  })
  handleLoggedIpc(desktopChannels.pairChrome, async () => {
    await chromeAutomation.pair()
    if (!closeChromeBridge)
      closeChromeBridge = await startBrowserUseBridge(chromeAutomation, {
        type: 'chrome',
        name: 'Chrome (Sele extension)'
      })
    return getDesktopState()
  })
  handleLoggedIpc(desktopChannels.disconnectChrome, async () => {
    await chromeAutomation.disconnect()
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
    chromeAutomation.close()
    void closeChromeBridge?.()
  })
}
