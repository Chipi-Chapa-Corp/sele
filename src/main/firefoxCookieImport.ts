import type { BrowserCookieImportBrowser } from '../shared/browser'

export type FirefoxFamilyCookieImportBrowser = Exclude<BrowserCookieImportBrowser, 'chrome'>

export type FirefoxProfileIniEntry = {
  default: boolean
  isRelative: boolean
  name: string
  path: string
}

export type FirefoxCookieRow = {
  expiry: number
  host: string
  isHttpOnly: number
  isPartitionedAttributeSet: number
  isSecure: number
  name: string
  originAttributes: string
  path: string
  sameSite: number
  schemeMap: number
  value: string
}

export type BrowserCookieDetails = {
  url: string
  name: string
  value: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  expirationDate?: number
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
}

export type BrowserCookieSkipReason = 'contextual' | 'expired' | 'invalid' | 'partitioned'

export type BrowserCookieConversionResult =
  | { cookie: BrowserCookieDetails; skipReason: null }
  | { cookie: null; skipReason: BrowserCookieSkipReason }

const firefoxSameSiteNone = 0
const firefoxSameSiteLax = 1
const firefoxSameSiteStrict = 2
const firefoxSameSiteUnset = 256
const firefoxSchemeHttp = 0x01
const firefoxSchemeHttps = 0x02
const firefoxMillisecondExpirySchemaVersion = 15

export const getLinuxBrowserProfileRootRelativePaths = (
  browser: FirefoxFamilyCookieImportBrowser
): string[] =>
  browser === 'zen'
    ? [
        '.zen',
        '.var/app/app.zen_browser.zen/zen',
        '.var/app/app.zen_browser.zen/.zen',
        '.var/app/io.github.zen_browser.zen/zen',
        '.var/app/io.github.zen_browser.zen/.zen'
      ]
    : ['.mozilla/firefox', '.var/app/org.mozilla.firefox/.mozilla/firefox']

export const getBrowserCookieProfileStorageKey = (options: {
  cookiePath: string
  sharesLocalStorage: boolean
  storageIdentity: string
  targetKey: string
}): string => {
  const storageScope = options.sharesLocalStorage ? 'local-storage' : options.targetKey
  return options.storageIdentity.startsWith('stat:')
    ? `${storageScope}\0${options.storageIdentity}`
    : `${storageScope}\0${options.cookiePath}`
}

const parseIniBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === '1' || value?.toLocaleLowerCase() === 'true') return true
  if (value === '0' || value?.toLocaleLowerCase() === 'false') return false
  return fallback
}

export const parseFirefoxProfilesIni = (contents: string): FirefoxProfileIniEntry[] => {
  const sections: Array<{ name: string; values: Record<string, string> }> = []
  let currentSection: { name: string; values: Record<string, string> } | null = null

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^\uFEFF/, '')
    if (!line || line.startsWith(';') || line.startsWith('#')) continue

    const sectionMatch = line.match(/^\[([^\]]+)]$/)
    if (sectionMatch) {
      currentSection = { name: sectionMatch[1], values: {} }
      sections.push(currentSection)
      continue
    }

    if (!currentSection) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim().toLocaleLowerCase()
    const value = line.slice(separatorIndex + 1).trim()
    if (key) currentSection.values[key] = value
  }

  return sections.flatMap((section) => {
    if (!/^profile\d+$/i.test(section.name)) return []

    const path = section.values.path?.trim()
    if (!path || path.includes('\0') || path.includes('\n') || path.includes('\r')) return []

    const name = section.values.name?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
    return [
      {
        default: parseIniBoolean(section.values.default, false),
        isRelative: parseIniBoolean(section.values.isrelative, true),
        name,
        path
      }
    ]
  })
}

export const getFirefoxCookieExpirationDate = (expiry: number, schemaVersion: number): number => {
  if (!Number.isFinite(expiry)) return Number.NaN

  // Firefox schema 15 migrated expiry values from seconds to milliseconds. The
  // magnitude fallback also makes this safe for databases with a missing or stale
  // user_version value.
  return schemaVersion >= firefoxMillisecondExpirySchemaVersion || expiry > 10_000_000_000
    ? expiry / 1_000
    : expiry
}

const getFirefoxCookieSameSite = (
  sameSite: number,
  secure: boolean
): BrowserCookieDetails['sameSite'] => {
  if (sameSite === firefoxSameSiteLax) return 'lax'
  if (sameSite === firefoxSameSiteStrict) return 'strict'
  if (sameSite === firefoxSameSiteNone && secure) return 'no_restriction'
  if (sameSite === firefoxSameSiteUnset || sameSite === firefoxSameSiteNone) {
    return 'unspecified'
  }

  return 'unspecified'
}

const getUrlHost = (host: string): string =>
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host

export const convertFirefoxCookie = (
  row: FirefoxCookieRow,
  schemaVersion: number,
  nowSeconds = Date.now() / 1_000
): BrowserCookieConversionResult => {
  if (row.isPartitionedAttributeSet || row.originAttributes.includes('partitionKey=')) {
    return { cookie: null, skipReason: 'partitioned' }
  }
  if (row.originAttributes) {
    return { cookie: null, skipReason: 'contextual' }
  }

  const domainCookie = row.host.startsWith('.')
  const host = (domainCookie ? row.host.slice(1) : row.host).trim()
  if (!host || /[\s/?#]/.test(host)) return { cookie: null, skipReason: 'invalid' }

  const expirationDate = getFirefoxCookieExpirationDate(Number(row.expiry), schemaVersion)
  if (!Number.isFinite(expirationDate)) return { cookie: null, skipReason: 'invalid' }
  if (expirationDate <= nowSeconds) return { cookie: null, skipReason: 'expired' }

  const secure = Boolean(row.isSecure)
  const usesHttps =
    secure ||
    (!(Number(row.schemeMap) & firefoxSchemeHttp) &&
      Boolean(Number(row.schemeMap) & firefoxSchemeHttps))
  const path = row.path?.startsWith('/') ? row.path : '/'

  return {
    cookie: {
      url: `${usesHttps ? 'https' : 'http'}://${getUrlHost(host)}/`,
      name: String(row.name ?? ''),
      value: String(row.value ?? ''),
      ...(domainCookie ? { domain: row.host } : {}),
      path,
      secure,
      httpOnly: Boolean(row.isHttpOnly),
      expirationDate,
      sameSite: getFirefoxCookieSameSite(Number(row.sameSite), secure)
    },
    skipReason: null
  }
}

export const getBrowserCookieDetails = (
  row: FirefoxCookieRow,
  schemaVersion: number,
  nowSeconds = Date.now() / 1_000
): BrowserCookieDetails | null => convertFirefoxCookie(row, schemaVersion, nowSeconds).cookie
