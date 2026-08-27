import { app, BrowserWindow, nativeTheme, shell, type WebContents } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  appIpcChannels,
  getAppWindowZoomShortcutAction,
  normalizeAppWindowZoomLevel,
  type AppColorScheme
} from '../shared/app'
import { disposeDatabase } from './database/sqlite'
import { disposeProviderAdapters } from './providers/providerService'
import { beginProviderIpcShutdown, registerProviderIpc } from './providers/registerProviderIpc'
import { registerAppIpc, sendAppWindowState } from './registerAppIpc'
import { disposeTerminalSessions, registerTerminalIpc } from './registerTerminalIpc'
import { registerBrowserIpc } from './registerBrowserIpc'
import {
  browserIpcChannels,
  getBrowserCloseShortcutAction,
  isBrowserPageUrl
} from '../shared/browser'

const getColorScheme = (): AppColorScheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

const getWindowBackgroundColor = (scheme = getColorScheme()): string =>
  scheme === 'dark' ? '#141516' : '#f5f5f3'

const browserSystemProtocols = new Set(['mailto:', 'tel:'])

const getUrlProtocol = (value: string): string | null => {
  try {
    return new URL(value).protocol
  } catch {
    return null
  }
}

const routeNewWindowUrl = (mainWindow: BrowserWindow, url: string): void => {
  if (isBrowserPageUrl(url)) {
    mainWindow.webContents.send(browserIpcChannels.openRequested, {
      id: crypto.randomUUID(),
      url
    })
    return
  }

  if (browserSystemProtocols.has(getUrlProtocol(url) ?? '')) {
    void shell.openExternal(url)
  }
}

const handleCloseShortcut = (
  mainWindow: BrowserWindow,
  event: Electron.Event,
  input: Electron.Input
): boolean => {
  const action = getBrowserCloseShortcutAction(input)
  if (!action) return false

  event.preventDefault()
  if (action === 'close-tab') {
    mainWindow.webContents.send(browserIpcChannels.closeActiveTabRequested)
  }
  return true
}

const secureBrowserWebContents = (mainWindow: BrowserWindow, guest: WebContents): void => {
  guest.setWindowOpenHandler(({ url }) => {
    routeNewWindowUrl(mainWindow, url)
    return { action: 'deny' }
  })

  const preventUnsupportedNavigation = (event: Electron.Event, url: string): void => {
    const protocol = getUrlProtocol(url)
    if (isBrowserPageUrl(url) || url === 'about:blank') return

    event.preventDefault()
    if (browserSystemProtocols.has(protocol ?? '')) void shell.openExternal(url)
  }

  guest.on('will-navigate', (event) => preventUnsupportedNavigation(event, event.url))
  guest.on('will-redirect', (event) => preventUnsupportedNavigation(event, event.url))
  guest.on('before-input-event', (event, input) => {
    handleCloseShortcut(mainWindow, event, input)
  })
}

const isProviderCliInvocation = (): boolean => {
  const args = process.argv.slice(1)
  const hasArg = (argument: string): boolean => args.includes(argument)
  const isCodexInvocation = hasArg('app-server') || hasArg('update') || hasArg('--version')
  const isClaudeRuntimeInvocation =
    hasArg('--input-format') && hasArg('--output-format') && hasArg('stream-json')
  const isCopilotRuntimeInvocation = hasArg('--headless') && (hasArg('--stdio') || hasArg('--port'))

  return (
    isCodexInvocation || isClaudeRuntimeInvocation || isCopilotRuntimeInvocation || hasArg('-V')
  )
}

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
    minWidth: 760,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: getWindowBackgroundColor(),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    sendAppWindowState(mainWindow)
    mainWindow.show()
  })

  mainWindow.on('maximize', () => sendAppWindowState(mainWindow))
  mainWindow.on('unmaximize', () => sendAppWindowState(mainWindow))
  mainWindow.on('enter-full-screen', () => sendAppWindowState(mainWindow))
  mainWindow.on('leave-full-screen', () => sendAppWindowState(mainWindow))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    routeNewWindowUrl(mainWindow, url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false

    if (params.src !== 'about:blank' && !isBrowserPageUrl(params.src)) event.preventDefault()
  })
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    secureBrowserWebContents(mainWindow, guest)
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (handleCloseShortcut(mainWindow, event, input)) return

    const action = getAppWindowZoomShortcutAction(input)
    if (!action) return

    event.preventDefault()

    const currentZoomLevel = normalizeAppWindowZoomLevel(mainWindow.webContents.getZoomLevel())
    const nextZoomLevel =
      action === 'reset'
        ? 0
        : normalizeAppWindowZoomLevel(currentZoomLevel + (action === 'in' ? 1 : -1))

    mainWindow.webContents.setZoomLevel(nextZoomLevel)
    mainWindow.webContents.send(appIpcChannels.windowZoomLevelUpdated, nextZoomLevel)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const focusExistingWindow = (): void => {
  const existingWindow = BrowserWindow.getAllWindows()[0]
  if (!existingWindow) return

  if (existingWindow.isMinimized()) existingWindow.restore()
  existingWindow.show()
  existingWindow.focus()
}

const startApp = (): void => {
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'system'
    nativeTheme.on('updated', () => updateAppColorScheme(getColorScheme()))
    electronApp.setAppUserModelId('com.sele')
    registerBrowserIpc()
    registerAppIpc()
    registerProviderIpc()
    registerTerminalIpc()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

if (isProviderCliInvocation()) {
  console.error(
    [
      'A coding-agent CLI invocation resolved to Sele itself.',
      'Check the provider executable path or shell PATH configuration.'
    ].join(' ')
  )
  app.exit(1)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusExistingWindow)
  startApp()
}

app.on('before-quit', () => {
  beginProviderIpcShutdown()
  disposeProviderAdapters()
  disposeTerminalSessions()
  void disposeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
