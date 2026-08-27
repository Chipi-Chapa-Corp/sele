import { ipcMain } from 'electron'
import type {
  BrowserCookieImportBrowser,
  BrowserCookieImportOptions,
  BrowserCookieProfileDiscoveryOptions
} from '../shared/browser'
import { browserIpcChannels } from '../shared/browser'
import { requireContainerTarget } from './containerTarget'
import { discoverBrowserCookieProfiles, importBrowserCookies } from './browserCookies'

const isCookieImportBrowser = (value: unknown): value is BrowserCookieImportBrowser =>
  value === 'chrome' || value === 'firefox' || value === 'zen'

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
  ipcMain.handle(browserIpcChannels.findCookieProfiles, (_event, value: unknown) =>
    discoverBrowserCookieProfiles(getCookieProfileDiscoveryOptions(value))
  )
  ipcMain.handle(browserIpcChannels.importCookies, (_event, value: unknown) =>
    importBrowserCookies(getCookieImportOptions(value))
  )
}
