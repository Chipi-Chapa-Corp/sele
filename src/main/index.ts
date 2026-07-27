import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { appIpcChannels, type AppColorScheme } from '../shared/app'
import { disposeDatabase } from './database/sqlite'
import { registerFreezeDiagnostics } from './freezeDiagnostics'
import { disposeProviderAdapters } from './providers/providerService'
import { registerProviderIpc } from './providers/registerProviderIpc'
import { registerAppIpc, sendAppWindowState } from './registerAppIpc'

const getColorScheme = (): AppColorScheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

const getWindowBackgroundColor = (scheme = getColorScheme()): string =>
  scheme === 'dark' ? '#141516' : '#f5f5f3'

let disposeFreezeDiagnostics: (() => void) | null = null

const updateAppColorScheme = (scheme: AppColorScheme): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.setBackgroundColor(getWindowBackgroundColor(scheme))
    window.webContents.send(appIpcChannels.colorSchemeUpdated, scheme)
  })
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: getWindowBackgroundColor(),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.on('ready-to-show', () => {
    sendAppWindowState(mainWindow)
    mainWindow.show()
  })

  mainWindow.on('maximize', () => sendAppWindowState(mainWindow))
  mainWindow.on('unmaximize', () => sendAppWindowState(mainWindow))
  mainWindow.on('enter-full-screen', () => sendAppWindowState(mainWindow))
  mainWindow.on('leave-full-screen', () => sendAppWindowState(mainWindow))

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system'
  nativeTheme.on('updated', () => updateAppColorScheme(getColorScheme()))
  electronApp.setAppUserModelId('com.sele')
  registerAppIpc()
  registerProviderIpc()
  disposeFreezeDiagnostics = registerFreezeDiagnostics()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  disposeFreezeDiagnostics?.()
  disposeFreezeDiagnostics = null
  disposeProviderAdapters()
  void disposeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
