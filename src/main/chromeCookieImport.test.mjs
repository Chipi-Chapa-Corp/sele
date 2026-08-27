import { createCipheriv, createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chromeLinuxUserDataRoots,
  convertChromeCookie,
  decryptChromeCookieValue,
  deriveChromeLinuxV10Key,
  deriveChromeMacV10Key,
  deriveChromeV11Key,
  getChromeCookieExpirationDate,
  parseChromeLocalState
} from './chromeCookieImport.ts'

const baseCookie = {
  encryptedValue: '',
  expiresUtc: '13644473600000000',
  hasExpires: 1,
  host: '.example.com',
  isHttpOnly: 1,
  isSecure: 1,
  name: 'session',
  path: '/account',
  sameSite: 0,
  sourceScheme: 2,
  topFrameSiteKey: '',
  value: ''
}

// Test files are plain JavaScript, so this helper cannot carry a TypeScript return annotation.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const encryptChromeCookie = (tag, key, host, value, databaseVersion = 24) => {
  const valueBytes = Buffer.from(value)
  const plaintext =
    databaseVersion >= 24
      ? Buffer.concat([createHash('sha256').update(host).digest(), valueBytes])
      : valueBytes
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from(tag), cipher.update(plaintext), cipher.final()]).toString(
    'base64'
  )
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const encryptChromeGcmCookie = (key, host, value) => {
  const nonce = Buffer.alloc(12, 0x7a)
  const plaintext = Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from(value)])
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  return Buffer.concat([
    Buffer.from('v10'),
    nonce,
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString('base64')
}

test('parses named Chrome profiles and marks the last-used profile as default', () => {
  assert.deepEqual(
    parseChromeLocalState(
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Personal' },
            'Profile 1': { name: 'Work' },
            '../outside': { name: 'Unsafe' }
          },
          last_used: 'Profile 1'
        }
      })
    ),
    [
      { default: false, name: 'Personal', path: 'Default' },
      { default: true, name: 'Work', path: 'Profile 1' }
    ]
  )
})

test('includes native and Flatpak Chrome profile roots', () => {
  assert.ok(
    chromeLinuxUserDataRoots.some(({ relativePath }) => relativePath === '.config/google-chrome')
  )
  assert.ok(
    chromeLinuxUserDataRoots.some(
      ({ relativePath }) => relativePath === '.var/app/com.google.Chrome/config/google-chrome'
    )
  )
})

test('converts Chrome timestamps and cookie fields for Electron', () => {
  assert.equal(getChromeCookieExpirationDate(baseCookie.expiresUtc), 2_000_000_000)
  assert.deepEqual(convertChromeCookie(baseCookie, 'secret', 1_900_000_000), {
    cookie: {
      domain: '.example.com',
      expirationDate: 2_000_000_000,
      httpOnly: true,
      name: 'session',
      path: '/account',
      sameSite: 'no_restriction',
      secure: true,
      url: 'https://example.com/',
      value: 'secret'
    },
    skipReason: null
  })
  assert.equal(
    convertChromeCookie({ ...baseCookie, topFrameSiteKey: 'https://top.example' }, 'secret')
      .skipReason,
    'partitioned'
  )
  assert.equal(
    convertChromeCookie({ ...baseCookie, expiresUtc: '11644473700000000' }, 'secret', 200)
      .skipReason,
    'expired'
  )
})

test('decrypts Chrome Linux v10 and keyring-backed v11 cookies', () => {
  const v10Key = deriveChromeLinuxV10Key()
  const v11Key = deriveChromeV11Key('test-keyring-secret')
  const v10Cookie = {
    ...baseCookie,
    encryptedValue: encryptChromeCookie('v10', v10Key, baseCookie.host, 'legacy')
  }
  const v11Cookie = {
    ...baseCookie,
    encryptedValue: encryptChromeCookie('v11', v11Key, baseCookie.host, 'current')
  }

  assert.deepEqual(
    decryptChromeCookieValue(v10Cookie, 24, {
      v10: { algorithm: 'aes-128-cbc', key: v10Key }
    }),
    {
      protection: null,
      value: 'legacy'
    }
  )
  assert.deepEqual(
    decryptChromeCookieValue(v11Cookie, 24, {
      v11: { algorithm: 'aes-128-cbc', key: v11Key }
    }),
    {
      protection: null,
      value: 'current'
    }
  )
  assert.deepEqual(
    decryptChromeCookieValue(v11Cookie, 24, {
      v11: { algorithm: 'aes-128-cbc', key: Buffer.alloc(16) }
    }),
    {
      protection: 'v11',
      value: null
    }
  )
})

test('decrypts macOS Keychain and Windows DPAPI-derived Chrome v10 cookies', () => {
  const macKey = deriveChromeMacV10Key('mac-keychain-secret')
  const windowsKey = Buffer.alloc(32, 0x4c)
  const macCookie = {
    ...baseCookie,
    encryptedValue: encryptChromeCookie('v10', macKey, baseCookie.host, 'mac')
  }
  const windowsCookie = {
    ...baseCookie,
    encryptedValue: encryptChromeGcmCookie(windowsKey, baseCookie.host, 'windows')
  }

  assert.deepEqual(
    decryptChromeCookieValue(macCookie, 24, {
      v10: { algorithm: 'aes-128-cbc', key: macKey }
    }),
    {
      protection: null,
      value: 'mac'
    }
  )
  assert.deepEqual(
    decryptChromeCookieValue(windowsCookie, 24, {
      v10: { algorithm: 'aes-256-gcm', key: windowsKey }
    }),
    {
      protection: null,
      value: 'windows'
    }
  )
})

test('does not decrypt Chrome cookies with a mismatched key', () => {
  const v11Key = deriveChromeV11Key('test-keyring-secret')
  const v11Cookie = {
    ...baseCookie,
    encryptedValue: encryptChromeCookie('v11', v11Key, baseCookie.host, 'current')
  }

  assert.deepEqual(
    decryptChromeCookieValue(v11Cookie, 24, {
      v11: { algorithm: 'aes-128-cbc', key: Buffer.alloc(16) }
    }),
    {
      protection: 'v11',
      value: null
    }
  )
})

test('reports unsupported Chrome cookie protection tags', () => {
  assert.deepEqual(
    decryptChromeCookieValue(
      { ...baseCookie, encryptedValue: Buffer.from('v12payload').toString('base64') },
      24,
      {}
    ),
    { protection: 'v12', value: null }
  )
  assert.deepEqual(
    decryptChromeCookieValue(
      { ...baseCookie, encryptedValue: Buffer.from('v20payload').toString('base64') },
      24,
      {}
    ),
    { protection: 'v20', value: null }
  )
})
