import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import Database from 'better-sqlite3'
import { session } from 'electron'
import type { AppContainerTarget } from '../shared/app'
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
  type ChromeCookieRow
} from './chromeCookieImport'
import { chromeCookieReaderScript } from './chromeCookieReader'
import { getContainerTargetKey, normalizeContainerTarget } from './containerTarget'
import { getCurrentContainerHostBridge, getCurrentContainerTarget } from './currentContainer'
import {
  convertFirefoxCookie,
  getBrowserCookieProfileStorageKey,
  getLinuxBrowserProfileRootRelativePaths,
  parseFirefoxProfilesIni,
  type FirefoxCookieRow,
  type FirefoxFamilyCookieImportBrowser,
  type FirefoxProfileIniEntry
} from './firefoxCookieImport'
import { firefoxCookieReaderScript } from './firefoxCookieReader'
import { getHostCommand } from './hostProcess'

type BrowserProfileSource = {
  container: AppContainerTarget | null
  label: string
}

type BrowserProfileMetadataFile = {
  contents: string
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

type FirefoxCookieDatabase = {
  cookies: FirefoxCookieRow[]
  schemaVersion: number
}

type ChromeCookieDatabase = {
  cookies: ChromeCookieRow[]
  databaseVersion: number
}

type PathOperations = Pick<typeof posix, 'basename' | 'dirname' | 'isAbsolute' | 'join' | 'resolve'>

const browserPartition = 'persist:sele-browser'
const browserProfileRegistry = new Map<string, RegisteredBrowserProfile>()
const maximumRegisteredProfiles = 200
const targetCommandTimeoutMs = 15_000
const targetCommandMaxBuffer = 32 * 1024 * 1024

const getBrowserProfileDiscoveryScript = (browser: FirefoxFamilyCookieImportBrowser): string =>
  `
if ! command -v base64 >/dev/null 2>&1; then
  exit 127
fi
encode() {
  base64 | tr -d '\\n'
}
for root in ${getLinuxBrowserProfileRootRelativePaths(browser)
    .map((path) => `"$HOME/${path}"`)
    .join(' ')}; do
  ini="$root/profiles.ini"
  if [ -r "$ini" ]; then
    printf 'I\\t'
    printf '%s' "$ini" | encode
    printf '\\t'
    encode < "$ini"
    printf '\\n'
  fi
done
`.trim()

const getBrowserName = (browser: BrowserCookieImportBrowser): string =>
  browser === 'chrome' ? 'Chrome' : browser === 'zen' ? 'Zen' : 'Firefox'

const getDirectProfilesIniFiles = (
  browser: FirefoxFamilyCookieImportBrowser
): BrowserProfileMetadataFile[] => {
  const browserName = getBrowserName(browser)

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    return appData
      ? [
          {
            contents: '',
            installation: browserName,
            path:
              browser === 'zen'
                ? win32.join(appData, 'zen', 'profiles.ini')
                : win32.join(appData, 'Mozilla', 'Firefox', 'profiles.ini')
          }
        ]
      : []
  }

  if (process.platform === 'darwin') {
    return [
      {
        contents: '',
        installation: browserName,
        path: join(
          homedir(),
          'Library',
          'Application Support',
          browser === 'zen' ? 'zen' : 'Firefox',
          'profiles.ini'
        )
      }
    ]
  }

  return getLinuxBrowserProfileRootRelativePaths(browser).map((relativePath) => ({
    contents: '',
    installation: `${browserName}${relativePath.startsWith('.var/app/') ? ' Flatpak' : ''}`,
    path: join(homedir(), relativePath, 'profiles.ini')
  }))
}

const getDirectChromeLocalStateFiles = (): BrowserProfileMetadataFile[] => {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    return localAppData
      ? [
          {
            contents: '',
            installation: 'Chrome',
            path: win32.join(localAppData, 'Google', 'Chrome', 'User Data', 'Local State')
          }
        ]
      : []
  }

  if (process.platform === 'darwin') {
    return [
      {
        contents: '',
        installation: 'Chrome',
        path: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Local State')
      }
    ]
  }

  return chromeLinuxUserDataRoots.map(({ installation, relativePath }) => ({
    contents: '',
    installation,
    path: join(homedir(), relativePath, 'Local State')
  }))
}

const getPathOperations = (direct: boolean): PathOperations => {
  if (!direct || process.platform !== 'win32') return posix
  return win32
}

const resolveProfileDirectory = (
  iniPath: string,
  profile: FirefoxProfileIniEntry,
  pathOperations: PathOperations
): string =>
  profile.isRelative
    ? pathOperations.resolve(pathOperations.dirname(iniPath), profile.path)
    : profile.path

const getDirectCookieStorageIdentity = async (path: string): Promise<string | null> => {
  try {
    await access(path, constants.R_OK)
    const details = await stat(path)
    return details.isFile() ? `stat:${details.dev}:${details.ino}` : null
  } catch {
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

const readDirectProfilesIniFiles = async (
  browser: FirefoxFamilyCookieImportBrowser
): Promise<BrowserProfileMetadataFile[]> => {
  const files = await Promise.all(
    getDirectProfilesIniFiles(browser).map(async (file) => {
      try {
        return { ...file, contents: await readFile(file.path, 'utf8') }
      } catch {
        return null
      }
    })
  )
  return files.flatMap((file) => (file ? [file] : []))
}

const readDirectChromeLocalStateFiles = async (): Promise<BrowserProfileMetadataFile[]> => {
  const files = await Promise.all(
    getDirectChromeLocalStateFiles().map(async (file) => {
      try {
        return { ...file, contents: await readFile(file.path, 'utf8') }
      } catch {
        return null
      }
    })
  )
  return files.flatMap((file) => (file ? [file] : []))
}

const decodeBase64 = (value: string): string | null => {
  if (!value || !/^[A-Za-z\d+/]*={0,2}$/.test(value)) return null
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return null
  }
}

const commandWasUnavailable = (error: unknown): boolean => {
  const commandError = error as { code?: unknown }
  if (commandError?.code === 'ENOENT' || commandError?.code === 127) return true
  const message = error instanceof Error ? error.message.toLocaleLowerCase() : ''
  return message.includes('command not found') || message.includes('not found: python')
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

const readTargetProfilesIniFiles = async (
  container: AppContainerTarget | null,
  browser: FirefoxFamilyCookieImportBrowser
): Promise<BrowserProfileMetadataFile[]> => {
  const output = await runTargetTextCommand(
    'sh',
    ['-lc', getBrowserProfileDiscoveryScript(browser)],
    container
  )
  const browserName = getBrowserName(browser)

  return output.split(/\r?\n/).flatMap((line) => {
    const [kind, encodedPath, encodedContents] = line.split('\t')
    if (kind !== 'I' || !encodedPath || !encodedContents) return []

    const path = decodeBase64(encodedPath)
    const contents = decodeBase64(encodedContents)
    if (!path || contents == null) return []

    return [
      {
        contents,
        installation: `${browserName}${path.includes('/.var/app/') ? ' Flatpak' : ''}`,
        path
      } satisfies BrowserProfileMetadataFile
    ]
  })
}

const chromeProfileDiscoveryScript = `
if ! command -v base64 >/dev/null 2>&1; then
  exit 127
fi
encode() {
  base64 | tr -d '\\n'
}
for root in ${chromeLinuxUserDataRoots
  .map(({ relativePath }) => `"$HOME/${relativePath}"`)
  .join(' ')}; do
  state="$root/Local State"
  if [ -r "$state" ]; then
    printf 'C\\t'
    printf '%s' "$state" | encode
    printf '\\t'
    encode < "$state"
    printf '\\n'
  fi
done
`.trim()

const getChromeInstallationFromPath = (path: string): string =>
  chromeLinuxUserDataRoots.find(({ relativePath }) => path.endsWith(`/${relativePath}/Local State`))
    ?.installation ?? 'Chrome'

const readTargetChromeLocalStateFiles = async (
  container: AppContainerTarget | null
): Promise<BrowserProfileMetadataFile[]> => {
  const output = await runTargetTextCommand('sh', ['-lc', chromeProfileDiscoveryScript], container)

  return output.split(/\r?\n/).flatMap((line) => {
    const [kind, encodedPath, encodedContents] = line.split('\t')
    if (kind !== 'C' || !encodedPath || !encodedContents) return []

    const path = decodeBase64(encodedPath)
    const contents = decodeBase64(encodedContents)
    if (!path || contents == null) return []

    return [
      {
        contents,
        installation: getChromeInstallationFromPath(path),
        path
      } satisfies BrowserProfileMetadataFile
    ]
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

const discoverBrowserProfilesFromSource = async (
  source: BrowserProfileSource,
  browser: FirefoxFamilyCookieImportBrowser
): Promise<DiscoveredBrowserProfile[]> => {
  const direct = await shouldUseDirectAccess(source.container)
  const pathOperations = getPathOperations(direct)
  const iniFiles = direct
    ? await readDirectProfilesIniFiles(browser)
    : await readTargetProfilesIniFiles(source.container, browser)
  const candidates = iniFiles.flatMap((iniFile) =>
    parseFirefoxProfilesIni(iniFile.contents).map((profile) => {
      const profileDirectory = resolveProfileDirectory(iniFile.path, profile, pathOperations)
      return {
        cookiePath: pathOperations.join(profileDirectory, 'cookies.sqlite'),
        default: profile.default,
        description: `${source.label} · ${iniFile.installation} · ${pathOperations.basename(profileDirectory)}`,
        name: profile.name
      }
    })
  )
  const readablePaths = await getReadableCookiePaths(
    candidates.map(({ cookiePath }) => cookiePath),
    direct,
    source.container
  )

  return candidates.flatMap((candidate) =>
    readablePaths.has(candidate.cookiePath)
      ? [
          {
            ...candidate,
            container: source.container,
            localStatePath: null,
            storageIdentity: readablePaths.get(candidate.cookiePath) ?? 'path'
          } satisfies DiscoveredBrowserProfile
        ]
      : []
  )
}

const discoverChromeProfilesFromSource = async (
  source: BrowserProfileSource
): Promise<DiscoveredBrowserProfile[]> => {
  const direct = await shouldUseDirectAccess(source.container)
  const pathOperations = getPathOperations(direct)
  const localStateFiles = direct
    ? await readDirectChromeLocalStateFiles()
    : await readTargetChromeLocalStateFiles(source.container)
  const candidates = localStateFiles.flatMap((localStateFile) =>
    parseChromeLocalState(localStateFile.contents).map((profile) => {
      const profileDirectory = pathOperations.join(
        pathOperations.dirname(localStateFile.path),
        profile.path
      )
      return {
        cookiePaths: [
          pathOperations.join(profileDirectory, 'Network', 'Cookies'),
          pathOperations.join(profileDirectory, 'Cookies')
        ],
        default: profile.default,
        description: `${source.label} · ${localStateFile.installation} · ${pathOperations.basename(profileDirectory)}`,
        localStatePath: localStateFile.path,
        name: profile.name
      }
    })
  )
  const readablePaths = await getReadableCookiePaths(
    candidates.flatMap(({ cookiePaths }) => cookiePaths),
    direct,
    source.container
  )

  return candidates.flatMap((candidate) => {
    const cookiePath = candidate.cookiePaths.find((path) => readablePaths.has(path))
    if (!cookiePath) return []
    return [
      {
        container: source.container,
        cookiePath,
        default: candidate.default,
        description: candidate.description,
        localStatePath: candidate.localStatePath,
        name: candidate.name,
        storageIdentity: readablePaths.get(cookiePath) ?? 'path'
      } satisfies DiscoveredBrowserProfile
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

  if (
    detectedCurrentEnvironment?.kind === 'container' &&
    !sources.some(
      (source) =>
        source.container &&
        getContainerTargetKey(source.container) ===
          getContainerTargetKey(detectedCurrentEnvironment)
    )
  ) {
    sources.push({ container: detectedCurrentEnvironment, label: 'Current environment' })
  }

  return sources
}

export const discoverBrowserCookieProfiles = async (
  options: BrowserCookieProfileDiscoveryOptions
): Promise<BrowserCookieProfile[]> => {
  if (options.browser !== 'chrome' && options.browser !== 'firefox' && options.browser !== 'zen') {
    throw new Error('Unsupported browser')
  }

  const sources = await getBrowserProfileSources(options.currentEnvironment)
  const discoveredBySource = await Promise.all(
    sources.map((source) =>
      (options.browser === 'chrome'
        ? discoverChromeProfilesFromSource(source)
        : discoverBrowserProfilesFromSource(source, options.browser)
      ).catch(() => [])
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

const readDirectFirefoxCookieDatabase = (cookiePath: string): FirefoxCookieDatabase => {
  const database = new Database(cookiePath, { fileMustExist: true, readonly: true })

  try {
    database.pragma('query_only = ON')
    const schemaVersion = Number(database.pragma('user_version', { simple: true }))
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
      getDatabaseColumnExpression(columns, 'name', "''"),
      getDatabaseColumnExpression(columns, 'value', "''"),
      getDatabaseColumnExpression(columns, 'host', "''"),
      getDatabaseColumnExpression(columns, 'path', "'/'"),
      getDatabaseColumnExpression(columns, 'expiry', '0'),
      getDatabaseColumnExpression(columns, 'isSecure', '0'),
      getDatabaseColumnExpression(columns, 'isHttpOnly', '0'),
      getDatabaseColumnExpression(columns, 'sameSite', '256'),
      getDatabaseColumnExpression(columns, 'originAttributes', "''"),
      getDatabaseColumnExpression(columns, 'schemeMap', '0'),
      getDatabaseColumnExpression(columns, 'isPartitionedAttributeSet', '0')
    ]
    const cookies = database
      .prepare(`SELECT ${selectedColumns.join(', ')} FROM moz_cookies`)
      .all() as FirefoxCookieRow[]

    return { cookies, schemaVersion }
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
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return reader(snapshotPath)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

const readDirectFirefoxCookies = (cookiePath: string): Promise<FirefoxCookieDatabase> =>
  readCookieDatabaseSnapshot(cookiePath, readDirectFirefoxCookieDatabase)

const normalizeChromeCookieRow = (value: unknown): ChromeCookieRow | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.encryptedValue !== 'string' ||
    typeof row.expiresUtc !== 'string' ||
    typeof row.host !== 'string' ||
    typeof row.name !== 'string' ||
    typeof row.path !== 'string' ||
    typeof row.topFrameSiteKey !== 'string' ||
    typeof row.value !== 'string'
  ) {
    return null
  }

  const numbers = [
    row.hasExpires,
    row.isHttpOnly,
    row.isSecure,
    row.sameSite,
    row.sourceScheme
  ].map(Number)
  if (numbers.some((number) => !Number.isFinite(number))) return null

  return {
    encryptedValue: row.encryptedValue,
    expiresUtc: row.expiresUtc,
    hasExpires: numbers[0],
    host: row.host,
    isHttpOnly: numbers[1],
    isSecure: numbers[2],
    name: row.name,
    path: row.path,
    sameSite: numbers[3],
    sourceScheme: numbers[4],
    topFrameSiteKey: row.topFrameSiteKey,
    value: row.value
  }
}

const readDirectChromeCookieDatabase = (cookiePath: string): ChromeCookieDatabase => {
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
      { value?: unknown } | undefined

    return {
      databaseVersion: Number(versionRow?.value ?? 0),
      cookies: rows.flatMap((row) => {
        const encryptedValue = row.encrypted_value
        const normalized = normalizeChromeCookieRow({
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

const readDirectChromeCookies = (cookiePath: string): Promise<ChromeCookieDatabase> =>
  readCookieDatabaseSnapshot(cookiePath, readDirectChromeCookieDatabase)

const normalizeFirefoxCookieRow = (value: unknown): FirefoxCookieRow | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.name !== 'string' ||
    typeof row.value !== 'string' ||
    typeof row.host !== 'string' ||
    typeof row.path !== 'string' ||
    typeof row.originAttributes !== 'string'
  ) {
    return null
  }

  const numbers = [
    row.expiry,
    row.isSecure,
    row.isHttpOnly,
    row.sameSite,
    row.schemeMap,
    row.isPartitionedAttributeSet
  ].map(Number)
  if (numbers.some((number) => !Number.isFinite(number))) return null

  return {
    name: row.name,
    value: row.value,
    host: row.host,
    path: row.path,
    originAttributes: row.originAttributes,
    expiry: numbers[0],
    isSecure: numbers[1],
    isHttpOnly: numbers[2],
    sameSite: numbers[3],
    schemeMap: numbers[4],
    isPartitionedAttributeSet: numbers[5]
  }
}

const readTargetFirefoxCookies = async (
  profile: RegisteredBrowserProfile
): Promise<FirefoxCookieDatabase> => {
  let output: string | null = null
  const readerFailures: unknown[] = []
  for (const python of ['python3', 'python']) {
    try {
      output = await runTargetTextCommand(
        python,
        ['-c', firefoxCookieReaderScript, profile.cookiePath],
        profile.container,
        30_000
      )
      break
    } catch (error) {
      readerFailures.push(error)
      // Try the other common Python executable name.
    }
  }
  if (output == null) {
    if (readerFailures.length > 0 && readerFailures.every(commandWasUnavailable)) {
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

  const result = parsed as { cookies?: unknown; error?: unknown; schemaVersion?: unknown }
  if (typeof result.error === 'string') {
    throw getCookieDatabaseReadError(browserName, result.error)
  }
  const schemaVersion = Number(result.schemaVersion)
  if (!Number.isFinite(schemaVersion) || !Array.isArray(result.cookies)) {
    throw new Error(`${browserName} returned an unreadable cookie database.`)
  }

  return {
    schemaVersion,
    cookies: result.cookies.flatMap((cookie) => {
      const normalizedCookie = normalizeFirefoxCookieRow(cookie)
      return normalizedCookie ? [normalizedCookie] : []
    })
  }
}

const readFirefoxCookies = async (
  profile: RegisteredBrowserProfile
): Promise<FirefoxCookieDatabase> => {
  if (await shouldUseDirectAccess(profile.container)) {
    try {
      return readDirectFirefoxCookies(profile.cookiePath)
    } catch (error) {
      const browserName = getBrowserName(profile.browser)
      throw getCookieDatabaseReadError(
        browserName,
        error instanceof Error ? error.message : 'unknown database error'
      )
    }
  }

  return readTargetFirefoxCookies(profile)
}

const readTargetChromeCookies = async (
  profile: RegisteredBrowserProfile
): Promise<ChromeCookieDatabase> => {
  let output: string | null = null
  const readerFailures: unknown[] = []
  for (const python of ['python3', 'python']) {
    try {
      output = await runTargetTextCommand(
        python,
        ['-c', chromeCookieReaderScript, profile.cookiePath],
        profile.container,
        30_000
      )
      break
    } catch (error) {
      readerFailures.push(error)
    }
  }
  if (output == null) {
    if (readerFailures.length > 0 && readerFailures.every(commandWasUnavailable)) {
      throw new Error('Python is required to import cookies from this environment.')
    }
    throw new Error('Unable to start the cookie reader in this environment.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error('Chrome returned an unreadable cookie database.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Chrome returned an unreadable cookie database.')
  }

  const result = parsed as { cookies?: unknown; databaseVersion?: unknown; error?: unknown }
  if (typeof result.error === 'string') {
    throw getCookieDatabaseReadError('Chrome', result.error)
  }
  const databaseVersion = Number(result.databaseVersion)
  if (!Number.isFinite(databaseVersion) || !Array.isArray(result.cookies)) {
    throw new Error('Chrome returned an unreadable cookie database.')
  }

  return {
    databaseVersion,
    cookies: result.cookies.flatMap((cookie) => {
      const normalizedCookie = normalizeChromeCookieRow(cookie)
      return normalizedCookie ? [normalizedCookie] : []
    })
  }
}

const readChromeCookies = async (
  profile: RegisteredBrowserProfile
): Promise<ChromeCookieDatabase> => {
  if (await shouldUseDirectAccess(profile.container)) {
    try {
      return await readDirectChromeCookies(profile.cookiePath)
    } catch (error) {
      throw getCookieDatabaseReadError(
        'Chrome',
        error instanceof Error ? error.message : 'unknown database error'
      )
    }
  }

  return readTargetChromeCookies(profile)
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
    } catch {
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
  source: ChromeCookieDatabase,
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

  if (process.platform === 'darwin') {
    const unsupportedTag = [...protectionTags].find((tag) => tag !== 'v10')
    if (unsupportedTag)
      throw new Error(`Chrome cookie encryption ${unsupportedTag} is unsupported.`)
    return { v10: await getChromeMacV10Key(profile) }
  }

  if (process.platform === 'win32') {
    const unsupportedTag = [...protectionTags].find((tag) => tag !== 'v10')
    if (unsupportedTag)
      throw new Error(`Chrome cookie encryption ${unsupportedTag} is unsupported.`)
    return { v10: await getChromeWindowsV10Key(profile) }
  }

  if (process.platform === 'linux') {
    const unsupportedTag = [...protectionTags].find((tag) => tag !== 'v10' && tag !== 'v11')
    if (unsupportedTag) {
      throw new Error(`Chrome cookie encryption ${unsupportedTag} is unsupported.`)
    }

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

  throw new Error(`Importing encrypted Chrome cookies is unsupported on ${process.platform}.`)
}

const createCookieImportSkipReasons = (): BrowserCookieImportResult['skipReasons'] => ({
  contextual: 0,
  expired: 0,
  invalid: 0,
  partitioned: 0,
  protected: 0,
  rejected: 0
})

export const importBrowserCookies = async (
  options: BrowserCookieImportOptions
): Promise<BrowserCookieImportResult> => {
  if (options.browser !== 'chrome' && options.browser !== 'firefox' && options.browser !== 'zen') {
    throw new Error('Unsupported browser')
  }

  const profile = browserProfileRegistry.get(options.profileId)
  if (!profile || profile.browser !== options.browser) {
    throw new Error(`Reload ${getBrowserName(options.browser)} profiles and choose one to import.`)
  }

  const cookieStore = session.fromPartition(browserPartition).cookies
  let imported = 0
  const skipReasons = createCookieImportSkipReasons()

  if (options.browser === 'chrome') {
    const source = await readChromeCookies(profile)
    const decryptionKeys = await getChromeCookieDecryptionKeys(source, profile)
    const preparedCookies = source.cookies.map((chromeCookie) => ({
      chromeCookie,
      decryption: decryptChromeCookieValue(chromeCookie, source.databaseVersion, decryptionKeys)
    }))
    const encryptedCookieCount = preparedCookies.filter(({ chromeCookie }) =>
      Boolean(getChromeCookieProtectionTag(chromeCookie))
    ).length
    const decryptedCookieCount = preparedCookies.filter(
      ({ chromeCookie, decryption }) =>
        Boolean(getChromeCookieProtectionTag(chromeCookie)) && decryption.value != null
    ).length
    if (encryptedCookieCount > 0 && decryptedCookieCount === 0) {
      throw new Error("Unable to decrypt Chrome cookies with Chrome's key from the system keyring.")
    }

    for (const { chromeCookie, decryption } of preparedCookies) {
      if (decryption.value == null) {
        skipReasons.protected += 1
        continue
      }
      const conversion = convertChromeCookie(chromeCookie, decryption.value)
      if (conversion.skipReason) {
        skipReasons[conversion.skipReason] += 1
        continue
      }
      try {
        await cookieStore.set(conversion.cookie)
        imported += 1
      } catch {
        skipReasons.rejected += 1
      }
    }

    await cookieStore.flushStore()
    const skipped = Object.values(skipReasons).reduce((total, count) => total + count, 0)
    return { imported, skipped, skipReasons, total: source.cookies.length }
  }

  const source = await readFirefoxCookies(profile)

  for (const firefoxCookie of source.cookies) {
    const conversion = convertFirefoxCookie(firefoxCookie, source.schemaVersion)
    if (conversion.skipReason) {
      skipReasons[conversion.skipReason] += 1
      continue
    }

    try {
      await cookieStore.set(conversion.cookie)
      imported += 1
    } catch {
      skipReasons.rejected += 1
    }
  }

  await cookieStore.flushStore()
  const skipped = Object.values(skipReasons).reduce((total, count) => total + count, 0)
  return { imported, skipped, skipReasons, total: source.cookies.length }
}
