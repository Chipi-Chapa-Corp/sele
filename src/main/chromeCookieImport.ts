import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import type { BrowserCookieDetails, BrowserCookieSkipReason } from './firefoxCookieImport'

export type ChromeProfileEntry = {
  default: boolean
  name: string
  path: string
}

export type ChromeCookieRow = {
  encryptedValue: string
  expiresUtc: string
  hasExpires: number
  host: string
  isHttpOnly: number
  isSecure: number
  name: string
  path: string
  sameSite: number
  sourceScheme: number
  topFrameSiteKey: string
  value: string
}

export type ChromeCookieDecryptionKeys = {
  v10?: ChromeCookieDecryptionKey
  v11?: ChromeCookieDecryptionKey
}

export type ChromeCookieDecryptionKey = {
  algorithm: 'aes-128-cbc' | 'aes-256-gcm'
  key: Buffer
}

export type ChromeCookieDecryptionResult =
  { protection: null; value: string } | { protection: string; value: null }

export type ChromeCookieConversionResult =
  | { cookie: BrowserCookieDetails; skipReason: null }
  | { cookie: null; skipReason: BrowserCookieSkipReason }

export type ChromeUserDataRoot = {
  installation: string
  relativePath: string
}

const chromeWindowsEpochOffsetSeconds = 11_644_473_600n
const chromeSameSiteNone = 0
const chromeSameSiteLax = 1
const chromeSameSiteStrict = 2
const chromeSourceSchemeSecure = 2
const chromeAesIv = Buffer.alloc(16, 0x20)

export const deriveChromeLinuxV10Key = (): Buffer =>
  pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1')

export const deriveChromeV11Key = (secret: string): Buffer =>
  pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1')

export const deriveChromeMacV10Key = (secret: string): Buffer =>
  pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1')

export const chromeLinuxUserDataRoots: readonly ChromeUserDataRoot[] = [
  { installation: 'Chrome', relativePath: '.config/google-chrome' },
  { installation: 'Chrome Beta', relativePath: '.config/google-chrome-beta' },
  { installation: 'Chrome Dev', relativePath: '.config/google-chrome-unstable' },
  {
    installation: 'Chrome Flatpak',
    relativePath: '.var/app/com.google.Chrome/config/google-chrome'
  },
  {
    installation: 'Chrome Beta Flatpak',
    relativePath: '.var/app/com.google.ChromeBeta/config/google-chrome-beta'
  },
  {
    installation: 'Chrome Dev Flatpak',
    relativePath: '.var/app/com.google.ChromeDev/config/google-chrome-unstable'
  }
]

const isSafeChromeProfilePath = (value: string): boolean =>
  Boolean(value) &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !value.includes('\0') &&
  !value.includes('\n') &&
  !value.includes('\r')

export const parseChromeLocalState = (contents: string): ChromeProfileEntry[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []

  const profile = (parsed as { profile?: unknown }).profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return []
  const profileRecord = profile as { info_cache?: unknown; last_used?: unknown }
  const lastUsed = typeof profileRecord.last_used === 'string' ? profileRecord.last_used : 'Default'
  const infoCache = profileRecord.info_cache
  if (!infoCache || typeof infoCache !== 'object' || Array.isArray(infoCache)) {
    return [{ default: true, name: 'Default', path: 'Default' }]
  }

  const profiles = Object.entries(infoCache).flatMap(([path, metadata]) => {
    if (!isSafeChromeProfilePath(path)) return []
    const name =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as { name?: unknown }).name
        : null
    return [
      {
        default: path === lastUsed,
        name: typeof name === 'string' && name.trim() ? name.trim() : path,
        path
      }
    ]
  })

  return profiles.length > 0 ? profiles : [{ default: true, name: 'Default', path: 'Default' }]
}

export const getChromeCookieExpirationDate = (expiresUtc: string): number => {
  try {
    return Number(BigInt(expiresUtc) / 1_000_000n - chromeWindowsEpochOffsetSeconds)
  } catch {
    return Number.NaN
  }
}

const getUrlHost = (host: string): string =>
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host

export const convertChromeCookie = (
  row: ChromeCookieRow,
  value: string,
  nowSeconds = Date.now() / 1_000
): ChromeCookieConversionResult => {
  if (row.topFrameSiteKey) return { cookie: null, skipReason: 'partitioned' }

  const domainCookie = row.host.startsWith('.')
  const host = (domainCookie ? row.host.slice(1) : row.host).trim()
  if (!host || /[\s/?#]/.test(host)) return { cookie: null, skipReason: 'invalid' }

  let expirationDate: number | undefined
  if (row.hasExpires) {
    expirationDate = getChromeCookieExpirationDate(row.expiresUtc)
    if (!Number.isFinite(expirationDate)) return { cookie: null, skipReason: 'invalid' }
    if (expirationDate <= nowSeconds) return { cookie: null, skipReason: 'expired' }
  }

  const secure = Boolean(row.isSecure)
  const path = row.path?.startsWith('/') ? row.path : '/'
  const sameSite: BrowserCookieDetails['sameSite'] =
    row.sameSite === chromeSameSiteLax
      ? 'lax'
      : row.sameSite === chromeSameSiteStrict
        ? 'strict'
        : row.sameSite === chromeSameSiteNone && secure
          ? 'no_restriction'
          : 'unspecified'

  return {
    cookie: {
      url: `${secure || row.sourceScheme === chromeSourceSchemeSecure ? 'https' : 'http'}://${getUrlHost(host)}/`,
      name: row.name,
      value,
      ...(domainCookie ? { domain: row.host } : {}),
      path,
      secure,
      httpOnly: Boolean(row.isHttpOnly),
      ...(expirationDate == null ? {} : { expirationDate }),
      sameSite
    },
    skipReason: null
  }
}

export const decryptChromeCookieValue = (
  row: Pick<ChromeCookieRow, 'encryptedValue' | 'host' | 'value'>,
  databaseVersion: number,
  keys: ChromeCookieDecryptionKeys
): ChromeCookieDecryptionResult => {
  if (row.value) return { protection: null, value: row.value }

  const encryptedValue = Buffer.from(row.encryptedValue, 'base64')
  if (encryptedValue.length === 0) return { protection: null, value: '' }

  const protection = encryptedValue.subarray(0, 3).toString('ascii')
  const decryptionKey =
    protection === 'v10' ? keys.v10 : protection === 'v11' ? keys.v11 : undefined
  if (!decryptionKey) return { protection, value: null }

  try {
    const ciphertext = encryptedValue.subarray(3)
    let plaintext: Buffer
    if (decryptionKey.algorithm === 'aes-128-cbc') {
      const decipher = createDecipheriv('aes-128-cbc', decryptionKey.key, chromeAesIv)
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } else {
      if (ciphertext.length < 12 + 16) return { protection, value: null }
      const nonce = ciphertext.subarray(0, 12)
      const authenticationTag = ciphertext.subarray(ciphertext.length - 16)
      const encryptedPayload = ciphertext.subarray(12, ciphertext.length - 16)
      const decipher = createDecipheriv('aes-256-gcm', decryptionKey.key, nonce)
      decipher.setAuthTag(authenticationTag)
      plaintext = Buffer.concat([decipher.update(encryptedPayload), decipher.final()])
    }
    if (databaseVersion >= 24) {
      if (plaintext.length < 32) return { protection, value: null }
      const expectedHostHash = createHash('sha256').update(row.host).digest()
      if (!plaintext.subarray(0, 32).equals(expectedHostHash)) {
        return { protection, value: null }
      }
      return { protection: null, value: plaintext.subarray(32).toString('utf8') }
    }
    return { protection: null, value: plaintext.toString('utf8') }
  } catch {
    return { protection, value: null }
  }
}
