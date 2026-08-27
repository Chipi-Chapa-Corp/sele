import { ipcMain, webContents, type WebContents } from 'electron'
import type {
  BrowserCookieImportBrowser,
  BrowserCookieImportOptions,
  BrowserCookieProfileDiscoveryOptions,
  BrowserPageZoomOptions
} from '../shared/browser'
import {
  browserIpcChannels,
  browserScalePercentDefault,
  getBrowserPageHostname,
  normalizeBrowserScalePercent
} from '../shared/browser'
import { requireContainerTarget } from './containerTarget'
import { discoverBrowserCookieProfiles, importBrowserCookies } from './browserCookies'
import { getBrowserHostnameZoomScale } from './database/browserHostnameZoom'

const isCookieImportBrowser = (value: unknown): value is BrowserCookieImportBrowser =>
  value === 'chrome' || value === 'firefox' || value === 'zen'

const browserGuestDefaultScales = new WeakMap<WebContents, number>()
const activeBrowserRendererIds = new Set<number>()

export const getBrowserGuestDefaultScale = (guest: WebContents): number =>
  browserGuestDefaultScales.get(guest) ?? browserScalePercentDefault

export const isBrowserRendererActive = (renderer: WebContents): boolean =>
  activeBrowserRendererIds.has(renderer.id)

const getPageZoomOptions = (value: unknown): BrowserPageZoomOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid browser page zoom options')
  }

  const options = value as Partial<BrowserPageZoomOptions>
  if (
    typeof options.webContentsId !== 'number' ||
    !Number.isSafeInteger(options.webContentsId) ||
    typeof options.url !== 'string' ||
    options.url.length > 4096 ||
    typeof options.defaultScale !== 'number'
  ) {
    throw new Error('Invalid browser page zoom options')
  }

  return {
    webContentsId: options.webContentsId,
    url: options.url,
    defaultScale: normalizeBrowserScalePercent(options.defaultScale)
  }
}

const getCookieProfileDiscoveryOptions = (value: unknown): BrowserCookieProfileDiscoveryOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid browser profile discovery options')
  }

  const options = value as { browser?: unknown; currentEnvironment?: unknown }
  if (!isCookieImportBrowser(options.browser)) throw new Error('Unsupported browser')

  return {
    browser: options.browser,
    currentEnvironment: requireContainerTarget(options.currentEnvironment, { optional: true })
  }
}

const getCookieImportOptions = (value: unknown): BrowserCookieImportOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid browser cookie import options')
  }

  const options = value as { browser?: unknown; profileId?: unknown }
  if (!isCookieImportBrowser(options.browser)) throw new Error('Unsupported browser')
  if (
    typeof options.profileId !== 'string' ||
    !options.profileId ||
    options.profileId.length > 200
  ) {
    throw new Error('Invalid browser profile')
  }

  return { browser: options.browser, profileId: options.profileId }
}

export const registerBrowserIpc = (): void => {
  ipcMain.on(browserIpcChannels.setActive, (event, value: unknown) => {
    if (typeof value !== 'boolean') return

    const rendererId = event.sender.id
    if (!value) {
      activeBrowserRendererIds.delete(rendererId)
      return
    }

    if (activeBrowserRendererIds.has(rendererId)) return
    activeBrowserRendererIds.add(rendererId)
    event.sender.once('destroyed', () => activeBrowserRendererIds.delete(rendererId))
  })
  ipcMain.handle(browserIpcChannels.findCookieProfiles, (_event, value: unknown) =>
    discoverBrowserCookieProfiles(getCookieProfileDiscoveryOptions(value))
  )
  ipcMain.handle(browserIpcChannels.importCookies, (_event, value: unknown) =>
    importBrowserCookies(getCookieImportOptions(value))
  )
  ipcMain.handle(browserIpcChannels.resolvePageZoomScale, async (event, value: unknown) => {
    const options = getPageZoomOptions(value)
    const guest = webContents.fromId(options.webContentsId)
    if (!guest || guest.getType() !== 'webview' || guest.hostWebContents !== event.sender) {
      throw new Error('Invalid browser webview')
    }

    browserGuestDefaultScales.set(guest, options.defaultScale)
    const hostname = getBrowserPageHostname(options.url)
    if (!hostname) return options.defaultScale

    return (await getBrowserHostnameZoomScale(hostname)) ?? options.defaultScale
  })
}
