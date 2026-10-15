import { stopPtys } from './pty'
import { registerPreferences } from './registerPreferences'
import { registerAppUpdate } from './appUpdate'
import './logging'
import { startBrowserUseBridge } from './providers/codex/CodexBrowserBridge'
import { startBrowserAutomationService } from './browser/BrowserAutomation'
import { registerVisualizationProtocol } from './visualizationProtocol'
import { app, BrowserWindow, dialog, nativeTheme, type WebContents } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  appIpcChannels,
  appWindowZoomLevelDefault,
  getAppWindowZoomShortcutAction,
  normalizeAppWindowZoomLevel,
  type AppColorScheme
} from '../shared/app'
import { disposeDatabase } from './database/sqlite'
import { flushTokenUsage } from './database/tokenUsage'
import {
  startModelPricingRefresh,
  stopModelPricingRefresh
} from './providers/modelPricing/ModelsDevPricing'
import {
  deleteBrowserHostnameZoomScale,
  setBrowserHostnameZoomScale
} from './database/browserHostnameZoom'
import { disposeProviderAdapters } from './providers/providerService'
import { beginProviderIpcShutdown, registerProviderIpc } from './providers/registerProviderIpc'
import { registerAppIpc, sendAppWindowState } from './registerAppIpc'
import { openExternalLink } from './externalLink'
import { disposeTerminalSessions, registerTerminalIpc } from './registerTerminalIpc'
import {
  getBrowserGuestDefaultScale,
  isBrowserRendererActive,
  registerBrowserIpc
} from './registerBrowserIpc'
import {
  browserIpcChannels,
  getBrowserCloseShortcutAction,
  getBrowserPageScale,
  getBrowserPageHostname,
  getBrowserPageShortcutAction,
  getBrowserPageZoomFactor,
  getNextBrowserZoomScale,
  isBrowserPageUrl
} from '../shared/browser'

const getColorScheme = (): AppColorScheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

const getWindowBackgroundColor = (scheme = getColorScheme()): string =>
  scheme === 'dark' ? '#141516' : '#f5f5f3'

const rendererCrashStabilityWindowMs = 30_000

const browserSystemProtocols = new Set(['mailto:', 'tel:'])

const getUrlProtocol = (value: string): string | null => {
  try {
    return new URL(value).protocol
  } catch (error) {
    console.error('[caught:index:getUrlProtocol]', error)
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
    void openExternalLink(url).catch((error) => {
      console.error('[caught:index:routeNewWindowUrl]', error)
    })
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

const handleBrowserPageShortcut = (
  mainWindow: BrowserWindow,
  event: Electron.Event,
  input: Electron.Input,
  webContentsId: number | null
): boolean => {
  const action = getBrowserPageShortcutAction(input)
  if (!action) return false

  event.preventDefault()
  mainWindow.webContents.send(browserIpcChannels.pageShortcutRequested, {
    action,
    webContentsId
  })
  return true
}

const getNextZoomLevel = (
  currentZoomLevel: number,
  action: NonNullable<ReturnType<typeof getAppWindowZoomShortcutAction>>
): number =>
  action === 'reset'
    ? appWindowZoomLevelDefault
    : normalizeAppWindowZoomLevel(currentZoomLevel + (action === 'in' ? 1 : -1))

const secureBrowserWebContents = (mainWindow: BrowserWindow, guest: WebContents): void => {
  guest.setIgnoreMenuShortcuts(true)
  guest.setWindowOpenHandler(({ url }) => {
    routeNewWindowUrl(mainWindow, url)
    return { action: 'deny' }
  })

  const preventUnsupportedNavigation = (event: Electron.Event, url: string): void => {
    const protocol = getUrlProtocol(url)
    if (isBrowserPageUrl(url) || url === 'about:blank') return

    event.preventDefault()
    if (browserSystemProtocols.has(protocol ?? '')) {
      void openExternalLink(url).catch((error) => {
        console.error('[caught:index:preventUnsupportedNavigation]', error)
      })
    }
  }

  guest.on('will-navigate', (event) => preventUnsupportedNavigation(event, event.url))
  guest.on('will-redirect', (event) => preventUnsupportedNavigation(event, event.url))
  guest.on('before-input-event', (event, input) => {
    if (handleCloseShortcut(mainWindow, event, input)) return
    if (handleBrowserPageShortcut(mainWindow, event, input, guest.id)) return

    const zoomAction = getAppWindowZoomShortcutAction(input)
    if (!zoomAction) return

    event.preventDefault()
    const applicationZoomFactor = mainWindow.webContents.getZoomFactor()
    const nextScale = getNextBrowserZoomScale(
      getBrowserPageScale(guest.getZoomFactor(), applicationZoomFactor),
      zoomAction,
      getBrowserGuestDefaultScale(guest)
    )
    guest.setZoomFactor(getBrowserPageZoomFactor(nextScale, applicationZoomFactor))

    const hostname = getBrowserPageHostname(guest.getURL())
    if (hostname) {
      const persistZoom =
        zoomAction === 'reset'
          ? deleteBrowserHostnameZoomScale(hostname)
          : setBrowserHostnameZoomScale(hostname, nextScale)
      void persistZoom.catch((error) => {
        console.error('[caught:index:secureBrowserWebContents]', error)
      })
    }
  })
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

  let rendererCrashCount = 0
  let rendererCrashResetTimer: ReturnType<typeof setTimeout> | null = null
  let rendererCrashPromptOpen = false

  const cancelRendererCrashReset = (): void => {
    if (rendererCrashResetTimer === null) return
    clearTimeout(rendererCrashResetTimer)
    rendererCrashResetTimer = null
  }

  const scheduleRendererCrashReset = (): void => {
    cancelRendererCrashReset()
    rendererCrashResetTimer = setTimeout(() => {
      rendererCrashCount = 0
      rendererCrashResetTimer = null
    }, rendererCrashStabilityWindowMs)
  }

  const reloadRenderer = (): void => {
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.reload()
    }, 0)
  }

  mainWindow.on('closed', cancelRendererCrashReset)
  mainWindow.webContents.on('did-finish-load', scheduleRendererCrashReset)
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || mainWindow.isDestroyed()) return

    console.error(
      `Sele renderer stopped unexpectedly: ${details.reason} (exit code ${details.exitCode}).`
    )
    cancelRendererCrashReset()
    rendererCrashCount += 1

    if (rendererCrashCount === 1) {
      reloadRenderer()
      return
    }
    if (rendererCrashPromptOpen) return

    rendererCrashPromptOpen = true
    void dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        buttons: ['Reload', 'Close'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'Sele renderer stopped',
        message: 'Sele could not recover the interface.',
        detail: `The renderer stopped repeatedly (${details.reason}). Reload it to try again.`
      })
      .then(({ response }) => {
        if (mainWindow.isDestroyed()) return
        if (response === 0) {
          rendererCrashCount = 0
          reloadRenderer()
        } else {
          mainWindow.close()
        }
      })
      .catch((error: unknown) => {
        console.error('Unable to show the renderer recovery prompt.', error)
        if (!mainWindow.isDestroyed()) mainWindow.close()
      })
      .finally(() => {
        rendererCrashPromptOpen = false
      })
  })

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
    webPreferences.backgroundThrottling = false
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false

    if (params.src !== 'about:blank' && !isBrowserPageUrl(params.src)) event.preventDefault()
  })
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    secureBrowserWebContents(mainWindow, guest)
  })
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (handleCloseShortcut(mainWindow, event, input)) return
    if (
      isBrowserRendererActive(mainWindow.webContents) &&
      handleBrowserPageShortcut(mainWindow, event, input, null)
    ) {
      return
    }

    const action = getAppWindowZoomShortcutAction(input)
    if (!action) return

    event.preventDefault()

    const nextZoomLevel = getNextZoomLevel(mainWindow.webContents.getZoomLevel(), action)
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
  app
    .whenReady()
    .then(async () => {
      await registerPreferences()
      startModelPricingRefresh()
      registerVisualizationProtocol()
      nativeTheme.themeSource = 'system'
      nativeTheme.on('updated', () => updateAppColorScheme(getColorScheme()))
      electronApp.setAppUserModelId('com.sele')
      registerAppIpc()
      registerAppUpdate()
      registerBrowserIpc()
      void startBrowserUseBridge(startBrowserAutomationService()).catch((error: unknown) =>
        console.error('Unable to start browser-use bridge:', error)
      )
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
    .catch((error: unknown) => {
      console.error('Unable to initialize Sele preferences.', error)
      dialog.showErrorBox(
        'Sele could not load preferences',
        String(error) + '\nSaved preferences have not been reset.'
      )
      app.exit(1)
    })
}

export const startApplication = (): { focus: () => void } => {
  startApp()
  return { focus: focusExistingWindow }
}

let finishingQuit = false
let quitReady = false
app.on('before-quit', (event) => {
  if (quitReady) return
  event.preventDefault()
  if (finishingQuit) return
  finishingQuit = true
  beginProviderIpcShutdown()
  disposeProviderAdapters()
  disposeTerminalSessions()
  void stopPtys()
    .then(stopModelPricingRefresh)
    .then(flushTokenUsage)
    .then(disposeDatabase)
    .catch((error: unknown) => {
      console.error('Unable to finish shutdown.', error)
    })
    .finally(() => {
      quitReady = true
      app.quit()
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
