import type { AppContainerTarget } from './app'

export type BrowserOpenRequest = {
  id: string
  url: string
}

export type BrowserPageShortcutAction = 'find' | 'reload'

export type BrowserPageShortcutRequest = {
  action: BrowserPageShortcutAction
  webContentsId: number | null
}

export type BrowserCookieImportBrowser = 'chrome' | 'firefox' | 'zen'

export type BrowserCookieProfile = {
  description: string
  id: string
  name: string
}

export type BrowserCookieProfileDiscoveryOptions = {
  browser: BrowserCookieImportBrowser
  currentEnvironment?: AppContainerTarget | null
}

export type BrowserCookieImportOptions = {
  browser: BrowserCookieImportBrowser
  profileId: string
}

export type BrowserCookieImportResult = {
  imported: number
  skipped: number
  skipReasons: {
    contextual: number
    expired: number
    invalid: number
    partitioned: number
    protected: number
    rejected: number
  }
  total: number
}

export const browserScalePercentDefault = 100
export const browserScalePercentMin = 25
export const browserScalePercentMax = 500

export const normalizeBrowserScalePercent = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return browserScalePercentDefault

  return Math.min(Math.max(Math.round(value), browserScalePercentMin), browserScalePercentMax)
}

const normalizeApplicationZoomFactor = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 1

export const getBrowserPageZoomFactor = (
  pageScale: number,
  applicationZoomFactor: number
): number =>
  (normalizeBrowserScalePercent(pageScale) / 100) *
  normalizeApplicationZoomFactor(applicationZoomFactor)

export const getBrowserPageScale = (zoomFactor: number, applicationZoomFactor: number): number =>
  normalizeBrowserScalePercent(
    (zoomFactor / normalizeApplicationZoomFactor(applicationZoomFactor)) * 100
  )

export type BrowserZoomAction = 'in' | 'out' | 'reset'

export const getNextBrowserZoomScale = (
  currentScale: number,
  action: BrowserZoomAction,
  resetScale = browserScalePercentDefault
): number => {
  if (action === 'reset') return normalizeBrowserScalePercent(resetScale)

  const normalizedScale = normalizeBrowserScalePercent(currentScale)
  return normalizeBrowserScalePercent(normalizedScale * (action === 'in' ? 1.2 : 1 / 1.2))
}

export type BrowserPageZoomOptions = {
  defaultScale: number
  url: string
  webContentsId: number
}

export type BrowserRendererApi = {
  findCookieProfiles: (
    options: BrowserCookieProfileDiscoveryOptions
  ) => Promise<BrowserCookieProfile[]>
  importCookies: (options: BrowserCookieImportOptions) => Promise<BrowserCookieImportResult>
  onOpenRequested: (listener: (request: BrowserOpenRequest) => void) => () => void
  onCloseActiveTabRequested: (listener: () => void) => () => void
  onPageShortcutRequested: (listener: (request: BrowserPageShortcutRequest) => void) => () => void
  resolvePageZoomScale: (options: BrowserPageZoomOptions) => Promise<number>
  setActive: (active: boolean) => void
}

export const browserIpcChannels = {
  findCookieProfiles: 'browser:find-cookie-profiles',
  importCookies: 'browser:import-cookies',
  openRequested: 'browser:open-requested',
  closeActiveTabRequested: 'browser:close-active-tab-requested',
  pageShortcutRequested: 'browser:page-shortcut-requested',
  resolvePageZoomScale: 'browser:resolve-page-zoom-scale',
  setActive: 'browser:set-active'
} as const

export type BrowserCloseShortcutInput = {
  alt?: boolean
  altKey?: boolean
  code?: string
  control?: boolean
  ctrlKey?: boolean
  isAutoRepeat?: boolean
  key?: string
  meta?: boolean
  metaKey?: boolean
  repeat?: boolean
  shift?: boolean
  shiftKey?: boolean
  type?: string
}

export type BrowserCloseShortcutAction = 'close-tab' | 'suppress-window-close'

const hasPrimaryModifier = (input: BrowserCloseShortcutInput): boolean =>
  Boolean(input.control || input.ctrlKey || input.meta || input.metaKey)

const hasAltModifier = (input: BrowserCloseShortcutInput): boolean =>
  Boolean(input.alt || input.altKey)

const hasShiftModifier = (input: BrowserCloseShortcutInput): boolean =>
  Boolean(input.shift || input.shiftKey)

export const getBrowserPageShortcutAction = (
  input: BrowserCloseShortcutInput
): BrowserPageShortcutAction | null => {
  if (input.type && input.type !== 'keyDown' && input.type !== 'keydown') return null
  if (input.repeat || input.isAutoRepeat || hasAltModifier(input) || hasShiftModifier(input)) {
    return null
  }

  const primaryModifier = hasPrimaryModifier(input)
  const key = input.key?.toLocaleLowerCase()
  const reloadKey = key === 'r' || input.code === 'KeyR'
  const findKey = key === 'f' || input.code === 'KeyF'

  if (primaryModifier && reloadKey) return 'reload'
  if (primaryModifier && findKey) return 'find'
  if (primaryModifier) return null
  if (key === 'f5' || input.code === 'F5') return 'reload'
  if (key === 'f2' || input.code === 'F2') return 'find'

  return null
}

export const getBrowserCloseShortcutAction = (
  input: BrowserCloseShortcutInput
): BrowserCloseShortcutAction | null => {
  if (input.type && input.type !== 'keyDown' && input.type !== 'keydown') return null
  if (hasAltModifier(input) || !hasPrimaryModifier(input)) {
    return null
  }
  if (input.key?.toLocaleLowerCase() !== 'w' && input.code !== 'KeyW') return null

  return hasShiftModifier(input) || input.repeat || input.isAutoRepeat
    ? 'suppress-window-close'
    : 'close-tab'
}

const browserPageProtocols = new Set(['http:', 'https:'])

export const getBrowserPageHostname = (value: string): string | null => {
  try {
    const url = new URL(value)
    return browserPageProtocols.has(url.protocol) && url.hostname
      ? url.hostname.toLocaleLowerCase()
      : null
  } catch {
    return null
  }
}

export const isBrowserPageUrl = (value: string): boolean => {
  try {
    return browserPageProtocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export const normalizeBrowserAddress = (value: string): string | null => {
  const address = value.trim()
  if (!address) return null

  const candidate = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/?#]|$)/i.test(
    address
  )
    ? `http://${address}`
    : /^[a-z][a-z\d+.-]*:/i.test(address)
      ? address
      : `https://${address}`

  try {
    const url = new URL(candidate)
    return browserPageProtocols.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export const getBrowserPageLabel = (value: string): string => {
  try {
    return new URL(value).hostname || 'New tab'
  } catch {
    return 'New tab'
  }
}

export const getBrowserFaviconUrl = (value: string): string | null => {
  try {
    const url = new URL(value)
    if (!browserPageProtocols.has(url.protocol)) return null

    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url.origin)}&sz=32`
  } catch {
    return null
  }
}
