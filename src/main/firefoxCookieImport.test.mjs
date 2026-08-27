import assert from 'node:assert/strict'
import test from 'node:test'
import {
  convertFirefoxCookie,
  getBrowserCookieProfileStorageKey,
  getBrowserCookieDetails,
  getFirefoxCookieExpirationDate,
  getLinuxBrowserProfileRootRelativePaths,
  parseFirefoxProfilesIni
} from './firefoxCookieImport.ts'

test('parses Firefox profiles and ignores non-profile sections', () => {
  assert.deepEqual(
    parseFirefoxProfilesIni(`
      \uFEFF[Profile0]
      Name=default-release
      IsRelative=1
      Path=Profiles/abc.default-release
      Default=1

      [Install123]
      Default=Profiles/abc.default-release

      [Profile1]
      IsRelative=0
      Path=/data/firefox/work
    `),
    [
      {
        default: true,
        isRelative: true,
        name: 'default-release',
        path: 'Profiles/abc.default-release'
      },
      {
        default: false,
        isRelative: false,
        name: 'work',
        path: '/data/firefox/work'
      }
    ]
  )
})

test('normalizes Firefox expiry units across database schema versions', () => {
  assert.equal(getFirefoxCookieExpirationDate(2_000_000_000, 14), 2_000_000_000)
  assert.equal(getFirefoxCookieExpirationDate(2_000_000_000_000, 15), 2_000_000_000)
  assert.equal(getFirefoxCookieExpirationDate(2_000_000_000_000, 0), 2_000_000_000)
})

test('maps Firefox domain cookies to Electron cookie details', () => {
  assert.deepEqual(
    getBrowserCookieDetails(
      {
        expiry: 2_000_000_000_000,
        host: '.example.com',
        isHttpOnly: 1,
        isPartitionedAttributeSet: 0,
        isSecure: 1,
        name: 'session',
        originAttributes: '',
        path: '/account',
        sameSite: 0,
        schemeMap: 2,
        value: 'secret'
      },
      15,
      1_900_000_000
    ),
    {
      domain: '.example.com',
      expirationDate: 2_000_000_000,
      httpOnly: true,
      name: 'session',
      path: '/account',
      sameSite: 'no_restriction',
      secure: true,
      url: 'https://example.com/',
      value: 'secret'
    }
  )
})

test('preserves host-only cookies and skips contextual or expired cookies', () => {
  const cookie = {
    expiry: 2_000_000_000,
    host: 'example.com',
    isHttpOnly: 0,
    isPartitionedAttributeSet: 0,
    isSecure: 0,
    name: 'preference',
    originAttributes: '',
    path: '/',
    sameSite: 256,
    schemeMap: 1,
    value: 'compact'
  }

  assert.deepEqual(getBrowserCookieDetails(cookie, 14, 1_900_000_000), {
    expirationDate: 2_000_000_000,
    httpOnly: false,
    name: 'preference',
    path: '/',
    sameSite: 'unspecified',
    secure: false,
    url: 'http://example.com/',
    value: 'compact'
  })
  assert.equal(
    getBrowserCookieDetails({ ...cookie, originAttributes: '^userContextId=2' }, 14),
    null
  )
  assert.equal(getBrowserCookieDetails({ ...cookie, isPartitionedAttributeSet: 1 }, 14), null)
  assert.equal(getBrowserCookieDetails({ ...cookie, expiry: 100 }, 14, 200), null)
})

test('classifies why a Firefox-family cookie cannot be imported', () => {
  const cookie = {
    expiry: 2_000_000_000,
    host: 'example.com',
    isHttpOnly: 0,
    isPartitionedAttributeSet: 0,
    isSecure: 0,
    name: 'preference',
    originAttributes: '',
    path: '/',
    sameSite: 256,
    schemeMap: 1,
    value: 'compact'
  }

  assert.equal(convertFirefoxCookie({ ...cookie, expiry: 100 }, 14, 200).skipReason, 'expired')
  assert.equal(
    convertFirefoxCookie({ ...cookie, originAttributes: '^userContextId=2' }, 14).skipReason,
    'contextual'
  )
  assert.equal(
    convertFirefoxCookie({ ...cookie, isPartitionedAttributeSet: 1 }, 14).skipReason,
    'partitioned'
  )
  assert.equal(
    convertFirefoxCookie({ ...cookie, host: 'not a host/path' }, 14).skipReason,
    'invalid'
  )
})

test('includes native, current Flatpak, and legacy Flatpak Zen profile roots', () => {
  assert.deepEqual(getLinuxBrowserProfileRootRelativePaths('zen'), [
    '.zen',
    '.var/app/app.zen_browser.zen/zen',
    '.var/app/app.zen_browser.zen/.zen',
    '.var/app/io.github.zen_browser.zen/zen',
    '.var/app/io.github.zen_browser.zen/.zen'
  ])
})

test('deduplicates a cookie database shared by the host and current environment', () => {
  const hostKey = getBrowserCookieProfileStorageKey({
    cookiePath: '/home/user/.mozilla/firefox/Profiles/default/cookies.sqlite',
    sharesLocalStorage: true,
    storageIdentity: 'stat:59:1222',
    targetKey: 'host'
  })
  const currentEnvironmentKey = getBrowserCookieProfileStorageKey({
    cookiePath: '/mnt/home/user/firefox/cookies.sqlite',
    sharesLocalStorage: true,
    storageIdentity: 'stat:59:1222',
    targetKey: 'distrobox:dev'
  })
  const remoteKey = getBrowserCookieProfileStorageKey({
    cookiePath: '/home/user/.mozilla/firefox/Profiles/default/cookies.sqlite',
    sharesLocalStorage: false,
    storageIdentity: 'stat:59:1222',
    targetKey: 'ssh:server/from:host'
  })

  assert.equal(hostKey, currentEnvironmentKey)
  assert.notEqual(hostKey, remoteKey)
})
