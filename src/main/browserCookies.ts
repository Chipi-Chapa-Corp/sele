import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import Database from 'better-sqlite3'
import { session } from 'electron'
import type { AppContainerTarget } from '../shared/app'
import {
  isExpectedCommandAbsenceError,
  isExpectedFileAbsenceError
} from '../shared/expectedAbsence.ts'
import type {
  BrowserCookieImportBrowser,
  BrowserCookieImportOptions,
  BrowserCookieImportResult,
  BrowserCookieProfile,
  BrowserCookieProfileDiscoveryOptions
} from '../shared/browser'
import {
  chromeLinuxUserDataRoots,
  convertChromeCookie,
  decryptChromeCookieValue,
  deriveChromeLinuxV10Key,
  deriveChromeMacV10Key,
  deriveChromeV11Key,
  parseChromeLocalState,
  type ChromeCookieDecryptionKeys,
  type ChromeCookieRow,
  type ChromeUserDataRoot
} from './chromeCookieImport'
import { chromeCookieReaderScript } from './chromeCookieReader'
import { getContainerTargetKey, normalizeContainerTarget } from './containerTarget'
import { getCurrentContainerHostBridge, getCurrentContainerTarget } from './currentContainer'
import {
  convertFirefoxCookie,
  getBrowserCookieProfileStorageKey,
  getLinuxBrowserProfileRootRelativePaths,
  parseFirefoxProfilesIni,
  type BrowserCookieConversionResult,
  type FirefoxCookieRow
} from './firefoxCookieImport'
import { firefoxCookieReaderScript } from './firefoxCookieReader'
import { getHostCommand } from './hostProcess'

type BrowserProfileSource = {
  container: AppContainerTarget | null
  label: string
}

type BrowserProfileMetadataLocation = {
  installation: string
  path: string
}

type DiscoveredBrowserProfile = {
  container: AppContainerTarget | null
  cookiePath: string
  default: boolean
  description: string
  localStatePath: string | null
  name: string
  storageIdentity: string
}

type RegisteredBrowserProfile = DiscoveredBrowserProfile & {
  browser: BrowserCookieImportBrowser
}

type CookieDatabase<TRow> = {
  cookies: TRow[]
  version: number
}

type CookieRowFields<TRow> = {
  [TKey in keyof TRow]: TRow[TKey] extends string ? 'string' : 'number'
}

const browserPartition = 'persist:sele-browser'
const browserProfileRegistry = new Map<string, RegisteredBrowserProfile>()
const maximumRegisteredProfiles = 200
const targetCommandTimeoutMs = 15_000
const targetCommandMaxBuffer = 32 * 1024 * 1024

const profileMetadataFiles = {
  chrome: {
    fileName: 'Local State',
    macDirectory: ['Google', 'Chrome'],
    windowsDirectory: ['Google', 'Chrome', 'User Data'],
    windowsRoot: 'LOCALAPPDATA'
  },
  firefox: {
    fileName: 'profiles.ini',
    macDirectory: ['Firefox'],
    windowsDirectory: ['Mozilla', 'Firefox'],
    windowsRoot: 'APPDATA'
  },
  zen: {
    fileName: 'profiles.ini',
    macDirectory: ['zen'],
    windowsDirectory: ['zen'],
    windowsRoot: 'APPDATA'
  }
} as const

const getBrowserName = (browser: BrowserCookieImportBrowser): string =>
  browser === 'chrome' ? 'Chrome' : browser === 'zen' ? 'Zen' : 'Firefox'

const getLinuxProfileRoots = (
  browser: BrowserCookieImportBrowser
): readonly ChromeUserDataRoot[] =>
  browser === 'chrome'
    ? chromeLinuxUserDataRoots
    : getLinuxBrowserProfileRootRelativePaths(browser).map((relativePath) => ({
        installation: `${getBrowserName(browser)}${relativePath.startsWith('.var/app/') ? ' Flatpak' : ''}`,
        relativePath
      }))

const getDirectProfileMetadataLocations = (
  browser: BrowserCookieImportBrowser
): BrowserProfileMetadataLocation[] => {
  const { fileName, macDirectory, windowsDirectory, windowsRoot } = profileMetadataFiles[browser]
  const installation = getBrowserName(browser)

  if (process.platform === 'win32') {
    const root = process.env[windowsRoot]
    return root ? [{ installation, path: win32.join(root, ...windowsDirectory, fileName) }] : []
  }

  if (process.platform === 'darwin') {
    return [
      {
        installation,
        path: join(homedir(), 'Library', 'Application Support', ...macDirectory, fileName)
      }
    ]
  }

  return getLinuxProfileRoots(browser).map((root) => ({
    installation: root.installation,
    path: join(homedir(), root.relativePath, fileName)
  }))
}

const getDirectCookieStorageIdentity = async (path: string): Promise<string | null> => {
  try {
    await access(path, constants.R_OK)
    const details = await stat(path)
    return details.isFile() ? `stat:${details.dev}:${details.ino}` : null
  } catch (error) {
    if (!isExpectedFileAbsenceError(error)) {
      console.error('[caught:browserCookies:getDirectCookieStorageIdentity]', error)
    }
    return null
  }
}

const runTargetTextCommand = async (
  file: string,
  args: string[],
  container: AppContainerTarget | null,
  timeout = targetCommandTimeoutMs
): Promise<string> => {
  const command = await getHostCommand(file, args, { container, env: process.env })

  return new Promise((resolveCommand, rejectCommand) => {
    const child = execFile(
      command.file,
      command.args,
      {
        cwd: command.cwd,
        encoding: 'utf8',
        env: command.env,
        maxBuffer: targetCommandMaxBuffer,
        timeout,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) rejectCommand(error)
        else resolveCommand(stdout)
      }
    )
    child.stdin?.end()
  })
}

const shouldUseDirectAccess = async (container: AppContainerTarget | null): Promise<boolean> => {
  if (!container || container.kind === 'host') {
    return !(await getCurrentContainerHostBridge())
  }

  const currentContainer = await getCurrentContainerTarget()
  return (
    currentContainer != null &&
    getContainerTargetKey(currentContainer) === getContainerTargetKey(container)
  )
}

const decodeBase64 = (value: string): string | null => {
  if (!value || !/^[A-Za-z\d+/]*={0,2}$/.test(value)) return null
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch (error) {
    console.error('[caught:browserCookies:decodeBase64]', error)
    return null
  }
}

const getCookieDatabaseReadError = (browserName: string, detail: string): Error => {
  const normalizedDetail = detail.trim().replace(/\s+/g, ' ').slice(0, 240)
  const lowerDetail = normalizedDetail.toLocaleLowerCase()
  if (lowerDetail.includes('database is locked')) {
    return new Error(`Unable to read ${browserName} cookies. Close ${browserName} and try again.`)
  }
  if (lowerDetail.includes('permission denied')) {
    return new Error(`Sele does not have permission to read this ${browserName} profile.`)
  }
  if (
    lowerDetail.includes('unsupported cookie database') ||
    lowerDetail.includes('no such table')
  ) {
    return new Error(`This ${browserName} profile uses an unsupported cookie database.`)
  }
  return new Error(
    normalizedDetail
      ? `Unable to read ${browserName} cookies: ${normalizedDetail}`
      : `Unable to read ${browserName} cookies.`
  )
}

const getProfileMetadataDiscoveryScript = (browser: BrowserCookieImportBrowser): string =>
  `
if ! command -v base64 >/dev/null 2>&1; then
  exit 127
fi
encode() {
  base64 | tr -d '\\n'
}
for root in ${getLinuxProfileRoots(browser)
    .map(({ relativePath }) => `"$HOME/${relativePath}"`)
    .join(' ')}; do
  file="$root/${profileMetadataFiles[browser].fileName}"
  if [ -r "$file" ]; then
    printf 'M\\t'
    printf '%s' "$file" | encode
    printf '\\t'
    encode < "$file"
    printf '\\n'
  fi
done
`.trim()

const getTargetInstallation = (browser: BrowserCookieImportBrowser, path: string): string =>
  browser === 'chrome'
    ? (chromeLinuxUserDataRoots.find(({ relativePath }) =>
        path.endsWith(`/${relativePath}/Local State`)
      )?.installation ?? 'Chrome')
    : `${getBrowserName(browser)}${path.includes('/.var/app/') ? ' Flatpak' : ''}`

const readProfileMetadataFiles = async (
  browser: BrowserCookieImportBrowser,
  container: AppContainerTarget | null,
  direct: boolean
): Promise<Array<BrowserProfileMetadataLocation & { contents: string }>> => {
  if (direct) {
    const files = await Promise.all(
      getDirectProfileMetadataLocations(browser).map(async (location) => {
        try {
          return { ...location, contents: await readFile(location.path, 'utf8') }
        } catch (error) {
          if (!isExpectedFileAbsenceError(error)) {
            console.error('[caught:browserCookies:readProfileMetadataFiles]', error)
          }
          return null
        }
      })
    )
    return files.flatMap((file) => (file ? [file] : []))
  }

  const output = await runTargetTextCommand(
    'sh',
    ['-lc', getProfileMetadataDiscoveryScript(browser)],
    container
  )

  return output.split(/\r?\n/).flatMap((line) => {
    const [kind, encodedPath, encodedContents] = line.split('\t')
    if (kind !== 'M' || !encodedPath || !encodedContents) return []

    const path = decodeBase64(encodedPath)
    const contents = decodeBase64(encodedContents)
    if (!path || contents == null) return []

    return [{ contents, installation: getTargetInstallation(browser, path), path }]
  })
}

const getReadableTargetCookiePaths = async (
  cookiePaths: string[],
  container: AppContainerTarget | null
): Promise<Map<string, string>> => {
  if (cookiePaths.length === 0) return new Map()

  const script = [
    'if ! command -v base64 >/dev/null 2>&1; then exit 127; fi',
    'for candidate do',
    '  if [ -r "$candidate" ]; then',
    '    identity=$(stat -Lc \'%d:%i\' "$candidate" 2>/dev/null || stat -f \'%d:%i\' "$candidate" 2>/dev/null || true)',
    "    printf 'P\\t'",
    "    printf '%s' \"$candidate\" | base64 | tr -d '\\n'",
    '    if [ -n "$identity" ]; then printf \'\\tstat:%s\\n\' "$identity"; else printf \'\\tpath\\n\'; fi',
    '  fi',
    'done'
  ].join('\n')
  const output = await runTargetTextCommand(
    'sh',
    ['-lc', script, 'sele-firefox-cookie-paths', ...cookiePaths],
    container
  )
  return new Map(
    output.split(/\r?\n/).flatMap((line) => {
      const [kind, encodedPath, storageIdentity] = line.split('\t')
      if (kind !== 'P' || !encodedPath || !storageIdentity) return []
      const path = decodeBase64(encodedPath)
      return path ? [[path, storageIdentity] as const] : []
    })
  )
}

const getReadableCookiePaths = async (
  cookiePaths: string[],
  direct: boolean,
  container: AppContainerTarget | null
): Promise<Map<string, string>> =>
  direct
    ? new Map(
        (
          await Promise.all(
            cookiePaths.map(async (cookiePath) => {
              const storageIdentity = await getDirectCookieStorageIdentity(cookiePath)
              return storageIdentity ? ([cookiePath, storageIdentity] as const) : null
            })
          )
        ).flatMap((entry) => (entry ? [entry] : []))
      )
    : getReadableTargetCookiePaths(cookiePaths, container)

const discoverProfilesFromSource = async (
  source: BrowserProfileSource,
  browser: BrowserCookieImportBrowser
): Promise<DiscoveredBrowserProfile[]> => {
  const direct = await shouldUseDirectAccess(source.container)
  const pathOperations = direct && process.platform === 'win32' ? win32 : posix
  const metadataFiles = await readProfileMetadataFiles(browser, source.container, direct)
  const candidates = metadataFiles.flatMap((file) => {
    const metadataDirectory = pathOperations.dirname(file.path)
    const getCandidate = (
      profile: { default: boolean; name: string },
      profileDirectory: string,
      cookieFiles: string[][],
      localStatePath: string | null
    ) => ({
      cookiePaths: cookieFiles.map((segments) =>
        pathOperations.join(profileDirectory, ...segments)
      ),
      default: profile.default,
      description: `${source.label} · ${file.installation} · ${pathOperations.basename(profileDirectory)}`,
      localStatePath,
      name: profile.name
    })

    return browser === 'chrome'
      ? parseChromeLocalState(file.contents).map((profile) =>
          getCandidate(
            profile,
            pathOperations.join(metadataDirectory, profile.path),
            [['Network', 'Cookies'], ['Cookies']],
            file.path
          )
        )
      : parseFirefoxProfilesIni(file.contents).map((profile) =>
          getCandidate(
            profile,
            profile.isRelative
              ? pathOperations.resolve(metadataDirectory, profile.path)
              : profile.path,
            [['cookies.sqlite']],
            null
          )
        )
  })
  const readablePaths = await getReadableCookiePaths(
    candidates.flatMap(({ cookiePaths }) => cookiePaths),
    direct,
    source.container
  )

  return candidates.flatMap(({ cookiePaths, ...candidate }) => {
    const cookiePath = cookiePaths.find((path) => readablePaths.has(path))
    if (!cookiePath) return []
    return [
      {
        ...candidate,
        container: source.container,
        cookiePath,
        storageIdentity: readablePaths.get(cookiePath) ?? 'path'
      }
    ]
  })
}

const getBrowserProfileSources = async (
  currentEnvironment: AppContainerTarget | null | undefined
): Promise<BrowserProfileSource[]> => {
  const sources: BrowserProfileSource[] = [{ container: null, label: 'Host' }]
  const normalizedCurrentEnvironment = normalizeContainerTarget(currentEnvironment)
  const detectedCurrentEnvironment =
    normalizedCurrentEnvironment.kind === 'container'
      ? normalizedCurrentEnvironment
      : await getCurrentContainerTarget()

  if (detectedCurrentEnvironment?.kind === 'container') {
    sources.push({ container: detectedCurrentEnvironment, label: 'Current environment' })
  }

  return sources
}

export const discoverBrowserCookieProfiles = async (
  options: BrowserCookieProfileDiscoveryOptions
): Promise<BrowserCookieProfile[]> => {
  const sources = await getBrowserProfileSources(options.currentEnvironment)
  const discoveredBySource = await Promise.all(
    sources.map((source) =>
      discoverProfilesFromSource(source, options.browser).catch((error) => {
        if (!isExpectedCommandAbsenceError(error)) {
          console.error('[caught:browserCookies:discoverBrowserCookieProfiles]', error)
        }
        return []
      })
    )
  )
  const uniqueProfiles = new Map<string, DiscoveredBrowserProfile>()

  for (const profile of discoveredBySource.flat()) {
    const remotelyHosted =
      profile.container?.kind === 'container' && profile.container.tool === 'ssh'
    const key = getBrowserCookieProfileStorageKey({
      cookiePath: profile.cookiePath,
      sharesLocalStorage: !remotelyHosted,
      storageIdentity: profile.storageIdentity,
      targetKey: getContainerTargetKey(profile.container)
    })
    if (!uniqueProfiles.has(key)) uniqueProfiles.set(key, profile)
  }

  browserProfileRegistry.clear()
  const profiles = [...uniqueProfiles.values()]
    .sort(
      (first, second) =>
        Number(second.default) - Number(first.default) ||
        first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' }) ||
        first.description.localeCompare(second.description)
    )
    .slice(0, maximumRegisteredProfiles)

  return profiles.map((profile) => {
    const id = randomUUID()
    browserProfileRegistry.set(id, { ...profile, browser: options.browser })
    return { id, name: profile.name, description: profile.description }
  })
}

const getDatabaseColumnExpression = (
  columns: ReadonlySet<string>,
  name: string,
  fallback: string
): string => (columns.has(name) ? `"${name}"` : `${fallback} AS "${name}"`)

const readDirectFirefoxCookieDatabase = (cookiePath: string): CookieDatabase<FirefoxCookieRow> => {
  const database = new Database(cookiePath, { fileMustExist: true, readonly: true })

  try {
    database.pragma('query_only = ON')
    const version = Number(database.pragma('user_version', { simple: true }))
    const columns = new Set(
      (database.prepare('PRAGMA table_info(moz_cookies)').all() as Array<{ name: string }>).map(
        ({ name }) => name
      )
    )
    const requiredColumns = ['name', 'value', 'host', 'path', 'expiry', 'isSecure', 'isHttpOnly']
    if (requiredColumns.some((column) => !columns.has(column))) {
      throw new Error('Unsupported Firefox cookie database')
    }

    const selectedColumns = [
      ...requiredColumns.map((column) => `"${column}"`),
      getDatabaseColumnExpression(columns, 'sameSite', '256'),
      getDatabaseColumnExpression(columns, 'originAttributes', "''"),
      getDatabaseColumnExpression(columns, 'schemeMap', '0'),
      getDatabaseColumnExpression(columns, 'isPartitionedAttributeSet', '0')
    ]
    const cookies = database
      .prepare(`SELECT ${selectedColumns.join(', ')} FROM moz_cookies`)
      .all() as FirefoxCookieRow[]

    return { cookies, version }
  } finally {
    database.close()
  }
}

const readCookieDatabaseSnapshot = async <TResult>(
  cookiePath: string,
  reader: (snapshotPath: string) => TResult
): Promise<TResult> => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'sele-cookie-import-'))
  const snapshotPath = join(temporaryDirectory, 'Cookies')

  try {
    await copyFile(cookiePath, snapshotPath)
    try {
      await copyFile(`${cookiePath}-wal`, `${snapshotPath}-wal`)
    } catch (error) {
      if (!isExpectedFileAbsenceError(error)) {
        console.error('[caught:browserCookies:readCookieDatabaseSnapshot]', error)
        throw error
      }
    }
    return reader(snapshotPath)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

const normalizeCookieRow = <TRow>(fields: CookieRowFields<TRow>, value: unknown): TRow | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row: Record<string, unknown> = {}
  for (const [name, kind] of Object.entries(fields)) {
    const field = (value as Record<string, unknown>)[name]
    if (kind === 'string' ? typeof field !== 'string' : !Number.isFinite(Number(field))) return null
    row[name] = kind === 'string' ? field : Number(field)
  }
  return row as TRow
}

const chromeCookieRowFields: CookieRowFields<ChromeCookieRow> = {
  encryptedValue: 'string',
  expiresUtc: 'string',
  hasExpires: 'number',
  host: 'string',
  isHttpOnly: 'number',
  isSecure: 'number',
  name: 'string',
  path: 'string',
  sameSite: 'number',
  sourceScheme: 'number',
  topFrameSiteKey: 'string',
  value: 'string'
}

const firefoxCookieRowFields: CookieRowFields<FirefoxCookieRow> = {
  expiry: 'number',
  host: 'string',
  isHttpOnly: 'number',
  isPartitionedAttributeSet: 'number',
  isSecure: 'number',
  name: 'string',
  originAttributes: 'string',
  path: 'string',
  sameSite: 'number',
  schemeMap: 'number',
  value: 'string'
}

const readDirectChromeCookieDatabase = (cookiePath: string): CookieDatabase<ChromeCookieRow> => {
  const database = new Database(cookiePath, { fileMustExist: true, readonly: true })

  try {
    database.pragma('query_only = ON')
    const columns = new Set(
      (database.prepare('PRAGMA table_info(cookies)').all() as Array<{ name: string }>).map(
        ({ name }) => name
      )
    )
    const requiredColumns = ['host_key', 'name', 'path', 'expires_utc', 'is_secure', 'is_httponly']
    if (requiredColumns.some((column) => !columns.has(column))) {
      throw new Error('Unsupported Chrome cookie database')
    }

    const selectedColumns = [
      '"host_key" AS "host"',
      '"name"',
      getDatabaseColumnExpression(columns, 'value', "''"),
      getDatabaseColumnExpression(columns, 'encrypted_value', "X''"),
      '"path"',
      'CAST("expires_utc" AS TEXT) AS "expiresUtc"',
      '"is_secure" AS "isSecure"',
      '"is_httponly" AS "isHttpOnly"',
      columns.has('samesite') ? '"samesite" AS "sameSite"' : '-1 AS "sameSite"',
      columns.has('source_scheme') ? '"source_scheme" AS "sourceScheme"' : '0 AS "sourceScheme"',
      columns.has('top_frame_site_key')
        ? '"top_frame_site_key" AS "topFrameSiteKey"'
        : '\'\' AS "topFrameSiteKey"',
      columns.has('has_expires') ? '"has_expires" AS "hasExpires"' : '1 AS "hasExpires"'
    ]
    const rows = database
      .prepare(`SELECT ${selectedColumns.join(', ')} FROM cookies`)
      .all() as Array<Record<string, unknown>>
    const versionRow = database.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
      | { value?: unknown }
      | undefined

    return {
      version: Number(versionRow?.value ?? 0),
      cookies: rows.flatMap((row) => {
        const encryptedValue = row.encrypted_value
        const normalized = normalizeCookieRow(chromeCookieRowFields, {
          ...row,
          encryptedValue: Buffer.isBuffer(encryptedValue) ? encryptedValue.toString('base64') : '',
          value: typeof row.value === 'string' ? row.value : ''
        })
        return normalized ? [normalized] : []
      })
    }
  } finally {
    database.close()
  }
}

const readTargetCookieDatabase = async <TRow>(
  profile: RegisteredBrowserProfile,
  readerScript: string,
  versionKey: 'databaseVersion' | 'schemaVersion',
  fields: CookieRowFields<TRow>
): Promise<CookieDatabase<TRow>> => {
  let output: string | null = null
  const readerFailures: unknown[] = []
  for (const python of ['python3', 'python']) {
    try {
      output = await runTargetTextCommand(
        python,
        ['-c', readerScript, profile.cookiePath],
        profile.container,
        30_000
      )
      break
    } catch (error) {
      if (!isExpectedCommandAbsenceError(error)) {
        console.error('[caught:browserCookies:readTargetCookieDatabase]', error)
      }
      readerFailures.push(error)
    }
  }
  if (output == null) {
    if (readerFailures.every((error) => isExpectedCommandAbsenceError(error))) {
      throw new Error('Python is required to import cookies from this environment.')
    }
    throw new Error('Unable to start the cookie reader in this environment.')
  }

  let parsed: unknown
  const browserName = getBrowserName(profile.browser)
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error(`${browserName} returned an unreadable cookie database.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${browserName} returned an unreadable cookie database.`)
  }

  const result = parsed as Record<string, unknown>
  if (typeof result.error === 'string') {
    throw getCookieDatabaseReadError(browserName, result.error)
  }
  const version = Number(result[versionKey])
  if (!Number.isFinite(version) || !Array.isArray(result.cookies)) {
    throw new Error(`${browserName} returned an unreadable cookie database.`)
  }

  return {
    version,
    cookies: result.cookies.flatMap((cookie) => {
      const normalizedCookie = normalizeCookieRow(fields, cookie)
      return normalizedCookie ? [normalizedCookie] : []
    })
  }
}

const readCookies = async <TRow>(
  profile: RegisteredBrowserProfile,
  readDirect: (snapshotPath: string) => CookieDatabase<TRow>,
  readerScript: string,
  versionKey: 'databaseVersion' | 'schemaVersion',
  fields: CookieRowFields<TRow>
): Promise<CookieDatabase<TRow>> => {
  if (!(await shouldUseDirectAccess(profile.container)))
    return readTargetCookieDatabase(profile, readerScript, versionKey, fields)
  try {
    return await readCookieDatabaseSnapshot(profile.cookiePath, readDirect)
  } catch (error) {
    throw getCookieDatabaseReadError(
      getBrowserName(profile.browser),
      error instanceof Error ? error.message : 'unknown database error'
    )
  }
}

const getChromeCookieProtectionTag = (cookie: ChromeCookieRow): string | null => {
  if (cookie.value || !cookie.encryptedValue) return null
  const encryptedValue = Buffer.from(cookie.encryptedValue, 'base64')
  return encryptedValue.length > 0 ? encryptedValue.subarray(0, 3).toString('ascii') : null
}

const getWindowsChromeKeyReaderScript = (localStatePath: string): string => {
  const encodedPath = Buffer.from(localStatePath, 'utf8').toString('base64')
  return `
$ErrorActionPreference = 'Stop'
$localStatePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$state = Get-Content -Raw -LiteralPath $localStatePath | ConvertFrom-Json
$encryptedKey = [Convert]::FromBase64String([string]$state.os_crypt.encrypted_key)
if ($encryptedKey.Length -le 5 -or [Text.Encoding]::ASCII.GetString($encryptedKey, 0, 5) -ne 'DPAPI') {
  throw 'Chrome DPAPI key is missing or invalid.'
}
$payload = New-Object byte[] ($encryptedKey.Length - 5)
[Array]::Copy($encryptedKey, 5, $payload, 0, $payload.Length)
$key = [Security.Cryptography.ProtectedData]::Unprotect(
  $payload,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Convert]::ToBase64String($key)
`.trim()
}

const getChromeMacV10Key = async (
  profile: RegisteredBrowserProfile
): Promise<ChromeCookieDecryptionKeys['v10']> => {
  let secret: string
  try {
    secret = (
      await runTargetTextCommand(
        'security',
        ['find-generic-password', '-w', '-a', 'Chrome', '-s', 'Chrome Safe Storage'],
        profile.container
      )
    ).trim()
  } catch {
    throw new Error('Chrome Keychain access was denied or its Safe Storage key is unavailable.')
  }
  if (!secret) throw new Error("Chrome's Safe Storage key is missing from Keychain.")
  return { algorithm: 'aes-128-cbc', key: deriveChromeMacV10Key(secret) }
}

const getChromeWindowsV10Key = async (
  profile: RegisteredBrowserProfile
): Promise<ChromeCookieDecryptionKeys['v10']> => {
  if (!profile.localStatePath) {
    throw new Error("Chrome's Local State file is unavailable for DPAPI decryption.")
  }

  let encodedKey: string | null = null
  const encodedCommand = Buffer.from(
    getWindowsChromeKeyReaderScript(profile.localStatePath),
    'utf16le'
  ).toString('base64')
  for (const powershell of ['powershell.exe', 'powershell']) {
    try {
      encodedKey = (
        await runTargetTextCommand(
          powershell,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
          profile.container
        )
      ).trim()
      break
    } catch (error) {
      if (!isExpectedCommandAbsenceError(error)) {
        console.error('[caught:browserCookies:getChromeWindowsV10Key]', error)
      }
      // Try the other standard PowerShell executable name.
    }
  }
  if (!encodedKey) {
    throw new Error(
      'Unable to decrypt the legacy Chrome key with Windows DPAPI for the current user.'
    )
  }

  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('Windows DPAPI returned an invalid Chrome key.')
  return { algorithm: 'aes-256-gcm', key }
}

const getChromeCookieDecryptionKeys = async (
  source: CookieDatabase<ChromeCookieRow>,
  profile: RegisteredBrowserProfile
): Promise<ChromeCookieDecryptionKeys> => {
  const protectionTags = new Set(
    source.cookies.flatMap((cookie) => {
      const tag = getChromeCookieProtectionTag(cookie)
      return tag ? [tag] : []
    })
  )
  if (protectionTags.size === 0) return {}
  if (protectionTags.has('v20')) {
    throw new Error("Chrome's Windows App-Bound cookie encryption (v20) is unsupported yet.")
  }
  if (protectionTags.has('v12')) {
    throw new Error("Chrome's Secret Portal cookie encryption is not supported yet.")
  }

  const { platform } = process
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') {
    throw new Error(`Importing encrypted Chrome cookies is unsupported on ${platform}.`)
  }
  const unsupportedTag = [...protectionTags].find(
    (tag) => tag !== 'v10' && (tag !== 'v11' || platform !== 'linux')
  )
  if (unsupportedTag) throw new Error(`Chrome cookie encryption ${unsupportedTag} is unsupported.`)
  if (platform === 'darwin') return { v10: await getChromeMacV10Key(profile) }
  if (platform === 'win32') return { v10: await getChromeWindowsV10Key(profile) }

  const keys: ChromeCookieDecryptionKeys = {
    v10: { algorithm: 'aes-128-cbc', key: deriveChromeLinuxV10Key() }
  }
  if (!protectionTags.has('v11')) return keys

  let secret: string
  try {
    secret = (
      await runTargetTextCommand(
        'secret-tool',
        ['lookup', 'application', 'chrome'],
        profile.container
      )
    ).trim()
  } catch {
    throw new Error(
      "Chrome's system keyring secret is unavailable. Unlock the keyring and ensure secret-tool is installed."
    )
  }
  if (!secret) {
    throw new Error("Chrome's system keyring does not contain its cookie encryption key.")
  }
  keys.v11 = { algorithm: 'aes-128-cbc', key: deriveChromeV11Key(secret) }
  return keys
}

export const importBrowserCookies = async (
  options: BrowserCookieImportOptions
): Promise<BrowserCookieImportResult> => {
  const profile = browserProfileRegistry.get(options.profileId)
  if (!profile || profile.browser !== options.browser) {
    throw new Error(`Reload ${getBrowserName(options.browser)} profiles and choose one to import.`)
  }

  const cookieStore = session.fromPartition(browserPartition).cookies
  const storeCookies = async <TCookie>(
    cookies: TCookie[],
    convert: (cookie: TCookie) => BrowserCookieConversionResult | { skipReason: 'protected' }
  ): Promise<BrowserCookieImportResult> => {
    let imported = 0
    const skipReasons = {
      contextual: 0,
      expired: 0,
      invalid: 0,
      partitioned: 0,
      protected: 0,
      rejected: 0
    }

    for (const cookie of cookies) {
      const conversion = convert(cookie)
      if (conversion.skipReason) {
        skipReasons[conversion.skipReason] += 1
        continue
      }
      try {
        await cookieStore.set(conversion.cookie)
        imported += 1
      } catch (error) {
        console.error('[caught:browserCookies:importBrowserCookies]', error)
        skipReasons.rejected += 1
      }
    }

    await cookieStore.flushStore()
    const skipped = Object.values(skipReasons).reduce((total, count) => total + count, 0)
    return { imported, skipped, skipReasons, total: cookies.length }
  }

  if (options.browser === 'chrome') {
    const source = await readCookies(
      profile,
      readDirectChromeCookieDatabase,
      chromeCookieReaderScript,
      'databaseVersion',
      chromeCookieRowFields
    )
    const decryptionKeys = await getChromeCookieDecryptionKeys(source, profile)
    const preparedCookies = source.cookies.map((chromeCookie) => ({
      chromeCookie,
      decryption: decryptChromeCookieValue(chromeCookie, source.version, decryptionKeys)
    }))
    const encryptedCookies = preparedCookies.filter(({ chromeCookie }) =>
      getChromeCookieProtectionTag(chromeCookie)
    )
    if (
      encryptedCookies.length > 0 &&
      encryptedCookies.every(({ decryption }) => decryption.value == null)
    ) {
      throw new Error("Unable to decrypt Chrome cookies with Chrome's key from the system keyring.")
    }

    return storeCookies(preparedCookies, ({ chromeCookie, decryption }) =>
      decryption.value == null
        ? { skipReason: 'protected' }
        : convertChromeCookie(chromeCookie, decryption.value)
    )
  }

  const source = await readCookies(
    profile,
    readDirectFirefoxCookieDatabase,
    firefoxCookieReaderScript,
    'schemaVersion',
    firefoxCookieRowFields
  )
  return storeCookies(source.cookies, (cookie) => convertFirefoxCookie(cookie, source.version))
}
