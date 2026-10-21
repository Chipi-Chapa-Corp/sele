import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppContainerTarget } from '../../../shared/app'
import type {
  ProviderAccountConfiguration,
  ProviderLoginResult,
  ProviderSourceOptions
} from '../../../shared/provider'
import { getContainerTargetKey } from '../../containerTarget'
import { getHostCommand } from '../../hostProcess'
import { ClaudeAccountLogin } from './ClaudeAccountLogin'
import { ClaudeAccountStore, getClaudeAccountEnvironment } from './ClaudeAccountStore'
import { createClaudeAccountStorage, runClaudeAccountCommand } from './ClaudeAccountStorage'
import { getClaudeExecutable } from './ClaudeExecutable'
import { parseClaudeVersion } from './ClaudeVersion'
import { fetchClaudeRateLimits } from './ClaudeUsage'
import { claudeAccountDisplayName } from '../AccountDisplayName'
import { isClaudeAuthenticationError } from './ClaudeAuthentication'

const usageFallbackCacheMs = 60_000
/** Wait before asking again after a failed request, unless Claude says how long. */
const usageFallbackRetryMs = 2 * 60_000
/** Keep showing the last limits through short outages and rate limiting. */
const usageFallbackStaleMs = 6 * 60 * 60_000

type Login = {
  id: string
  accountId: string
  flow: ClaudeAccountLogin
  reauthentication?: boolean
  verified?: boolean
  directory: string | null
}

// This is the oldest CLI version verified by Sele's credential-isolation probe.
const minimumVersion = '2.1.281'
export const supportsClaudeAccounts = (version: string): boolean => {
  const actual = version.split('.').map(Number)
  const minimum = minimumVersion.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (!Number.isFinite(actual[index])) return false
    if (actual[index] !== minimum[index]) return actual[index]! > minimum[index]!
  }
  return true
}

type ClaudeUsageCacheEntry = {
  at: number
  limits: Awaited<ReturnType<typeof fetchClaudeRateLimits>> | null
  /** Do not ask Claude again before this time (epoch ms). */
  retryAt: number
}

export class ClaudeAccounts {
  private stores = new Map<string, Promise<ClaudeAccountStore>>()
  private versions = new Map<string, Promise<string>>()
  private logins = new Map<string, Login>()
  private usageFallbacks = new Map<
    string,
    {
      expiresAt: number
      request: ReturnType<typeof fetchClaudeRateLimits>
    }
  >()
  /**
   * Last limits and retry time per source and account, kept on disk: Anthropic rate-limits
   * this endpoint, and a restart must neither blank the limits nor repeat refused requests.
   */
  private usageCacheFile: string | null = null
  private usageCache: Promise<Map<string, ClaudeUsageCacheEntry>> | null = null
  private usageCacheWrite: Promise<void> = Promise.resolve()

  setUsageCacheFile = (path: string): void => {
    this.usageCacheFile = path
    this.usageCache = null
  }

  private loadUsageCache = (): Promise<Map<string, ClaudeUsageCacheEntry>> => {
    this.usageCache ??= (async () => {
      const entries = new Map<string, ClaudeUsageCacheEntry>()
      if (!this.usageCacheFile) return entries
      try {
        const stored: unknown = JSON.parse(await readFile(this.usageCacheFile, 'utf8'))
        if (stored && typeof stored === 'object' && !Array.isArray(stored))
          for (const [key, value] of Object.entries(stored))
            if (value && typeof value === 'object' && typeof value.at === 'number')
              entries.set(key, value as ClaudeUsageCacheEntry)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT')
          console.error('Unable to read the Claude usage cache.', error)
      }
      return entries
    })()
    return this.usageCache
  }

  private saveUsageCache = (
    key: string,
    update: (entry: ClaudeUsageCacheEntry | undefined) => ClaudeUsageCacheEntry
  ): Promise<void> => {
    const write = this.usageCacheWrite.then(async () => {
      const entries = await this.loadUsageCache()
      entries.set(key, update(entries.get(key)))
      const file = this.usageCacheFile
      if (!file) return
      const temporary = join(dirname(file), `.claude-usage-${randomUUID()}.json`)
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 })
        await writeFile(temporary, JSON.stringify(Object.fromEntries(entries)), {
          mode: 0o600,
          flag: 'wx'
        })
        await rename(temporary, file)
      } catch (error) {
        console.error('Unable to save the Claude usage cache.', error)
      } finally {
        await rm(temporary, { force: true })
      }
    })
    this.usageCacheWrite = write.catch(() => undefined)
    return write
  }

  private usageCacheKey = async (options: ProviderSourceOptions): Promise<string> => {
    const accounts = (await (await this.store(options)).get()).accounts
    const active = accounts.find((account) => account.active)?.id ?? 'default'
    return `${getContainerTargetKey(options.container)}:${active}`
  }

  /** Records limits Claude returned directly, so later failures can still show them. */
  rememberUsage = async (
    options: ProviderSourceOptions,
    limits: ClaudeUsageCacheEntry['limits']
  ): Promise<void> => {
    if (!limits) return
    const key = await this.usageCacheKey(options)
    await this.saveUsageCache(key, () => ({ at: Date.now(), limits, retryAt: 0 }))
  }

  /** The last limits for the active account, if recent enough to show. */
  getLastUsage = async (
    options: ProviderSourceOptions = {}
  ): Promise<ClaudeUsageCacheEntry['limits'] | null> => {
    const entry = (await this.loadUsageCache()).get(await this.usageCacheKey(options))
    return entry?.limits && Date.now() - entry.at <= usageFallbackStaleMs ? entry.limits : null
  }

  private store = (options: ProviderSourceOptions = {}): Promise<ClaudeAccountStore> => {
    const key = getContainerTargetKey(options.container)
    let store = this.stores.get(key)
    if (!store) {
      store = createClaudeAccountStorage(options.container).then(
        (storage) => new ClaudeAccountStore(storage)
      )
      this.stores.set(key, store)
      void store.catch((error: unknown) => {
        console.error('Unable to initialize Claude account storage.', error)
        if (this.stores.get(key) === store) this.stores.delete(key)
      })
    }
    return store
  }

  private command = async (
    args: string[],
    options: ProviderSourceOptions,
    directory: string | null = null
  ) =>
    getHostCommand(
      options.container?.kind === 'container' ? 'claude' : getClaudeExecutable(),
      args,
      {
        container: options.container,
        env: getClaudeAccountEnvironment(process.env, directory)
      }
    )

  private ensureSupported = (options: ProviderSourceOptions): Promise<string> => {
    const key = getContainerTargetKey(options.container)
    let check = this.versions.get(key)
    if (!check) {
      check = (async () => {
        const output = await runClaudeAccountCommand(await this.command(['--version'], options))
        const version = parseClaudeVersion(output)
        if (!version || !supportsClaudeAccounts(version)) {
          throw new Error(
            `Claude account switching requires Claude Code ${minimumVersion} or newer. Update Claude to continue.`
          )
        }
        return version
      })()
      this.versions.set(key, check)
      void check.catch((error: unknown) => {
        console.error('Unable to enable Claude account switching.', error)
        if (this.versions.get(key) === check) this.versions.delete(key)
      })
    }
    return check
  }

  get = async (options: ProviderSourceOptions = {}): Promise<ProviderAccountConfiguration> => {
    await this.ensureSupported(options)
    return (await this.store(options)).get()
  }

  getWithDisplayNames = async (
    options: ProviderSourceOptions = {}
  ): Promise<ProviderAccountConfiguration> => {
    const version = await this.ensureSupported(options)
    const store = await this.store(options)
    const configuration = await store.get()
    const accounts = await Promise.all(
      configuration.accounts.map(async (account) => {
        const token = await store
          .getAccountAccessToken(
            account.id,
            options.container?.kind === 'container' ? {} : process.env
          )
          .catch(() => null)
        const displayName = token ? await claudeAccountDisplayName(token, version) : null
        return { ...account, displayName }
      })
    )
    return { ...configuration, accounts }
  }

  create = async (options: ProviderSourceOptions = {}) => {
    await this.ensureSupported(options)
    return (await this.store(options)).create()
  }

  getEnvironment = async (container?: AppContainerTarget | null): Promise<NodeJS.ProcessEnv> => {
    const store = await this.store({ container })
    const account = await store.getSelection()
    if (!account) return process.env
    await this.ensureSupported({ container })
    return getClaudeAccountEnvironment(process.env, store.credentialDirectory(account.id))
  }

  // Only the non-chat usage probe gets its own config. Claude keys its persisted
  // usage cache by oauthAccount in .claude.json, which stays stale when only the
  // secure store changes. Normal sessions must keep the shared config/history.
  getUsageEnvironment = async (
    container?: AppContainerTarget | null
  ): Promise<NodeJS.ProcessEnv> => {
    const store = await this.store({ container })
    // Preserve usage support on older CLIs until account switching is enabled.
    if ((await store.get()).accounts.length === 1 && !(await store.getPending())) return process.env
    await this.ensureSupported({ container })
    return store.getUsageEnvironment(process.env)
  }

  getUsageFallback = async (options: ProviderSourceOptions = {}) => {
    const version = await this.ensureSupported(options)
    const token = await (await this.store(options)).getUsageAccessToken(process.env)
    const cacheKey = await this.usageCacheKey(options)
    const saved = (await this.loadUsageCache()).get(cacheKey)
    const lastLimits = (): ClaudeUsageCacheEntry['limits'] | null =>
      saved?.limits && Date.now() - saved.at <= usageFallbackStaleMs ? saved.limits : null
    // The SDK normally caches this endpoint for a minute. Keep the fallback equally
    // bounded, but key it by the actual credentials rather than shared profile data.
    const key = `${getContainerTargetKey(options.container)}:${createHash('sha256').update(token).digest('hex')}`
    for (const [cachedKey, value] of this.usageFallbacks)
      if (value.expiresAt <= Date.now()) this.usageFallbacks.delete(cachedKey)
    const cached = this.usageFallbacks.get(key)
    if (cached) return cached.request
    // Claude refused recently (possibly before a restart): wait instead of asking again.
    if (saved?.retryAt && saved.retryAt > Date.now()) {
      const limits = lastLimits()
      if (limits) return limits
      throw new Error('Claude usage is rate limited. Sele will check again shortly.')
    }
    const request = fetchClaudeRateLimits(token, version).then(
      (limits) => {
        void this.saveUsageCache(cacheKey, () => ({ at: Date.now(), limits, retryAt: 0 }))
        return limits
      },
      (error: unknown) => {
        if (isClaudeAuthenticationError(error)) throw error
        // A failed refresh (usually HTTP 429) should not blank limits that were just shown,
        // and repeating the request right away only extends the rate limit.
        const retryAfter = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs
        const retryAfterMs = typeof retryAfter === 'number' ? retryAfter : usageFallbackRetryMs
        const entry = this.usageFallbacks.get(key)
        if (entry?.request === request) entry.expiresAt = Date.now() + retryAfterMs
        void this.saveUsageCache(cacheKey, (current) => ({
          at: current?.at ?? 0,
          limits: current?.limits ?? null,
          retryAt: Date.now() + retryAfterMs
        }))
        const limits = lastLimits()
        if (!limits) throw error
        console.warn('Showing the last Claude usage after a failed refresh.', error)
        return limits
      }
    )
    this.usageFallbacks.set(key, { request, expiresAt: Date.now() + usageFallbackCacheMs })
    try {
      return await request
    } catch (error) {
      // Authentication errors must be retried at once after the user signs in again.
      if (isClaudeAuthenticationError(error) && this.usageFallbacks.get(key)?.request === request)
        this.usageFallbacks.delete(key)
      throw error
    }
  }

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult | null> => {
    const store = await this.store(options)
    const pending = await store.getPending()
    if (!pending) return null
    return this.startLogin(pending.id, store.credentialDirectory(pending.id), false, options)
  }

  reauthenticate = async (options: ProviderSourceOptions = {}) => {
    const store = await this.store(options)
    if (await store.getPending())
      throw new Error('Finish or cancel the current Claude sign-in first.')
    const selected = await store.getSelection()
    const accountId = selected?.id ?? 'default'
    const login = await this.startLogin(
      accountId,
      selected ? store.credentialDirectory(accountId) : null,
      true,
      options
    )
    return { accountId, login }
  }

  private startLogin = async (
    accountId: string,
    directory: string | null,
    reauthentication: boolean,
    options: ProviderSourceOptions
  ): Promise<ProviderLoginResult> => {
    const store = await this.store(options)
    const key = getContainerTargetKey(options.container)
    if (this.logins.has(key)) throw new Error('Claude sign-in is already running.')
    const command = await this.command(['auth', 'login', '--claudeai'], options, directory)
    // Recheck after command resolution, which can involve SSH and shell discovery.
    const expectedId = reauthentication
      ? ((await store.getSelection())?.id ?? 'default')
      : (await store.getPending())?.id
    if (expectedId !== accountId || this.logins.has(key)) {
      throw new Error('Claude sign-in is no longer available.')
    }
    const login = {
      id: randomUUID(),
      accountId,
      directory,
      reauthentication,
      flow: new ClaudeAccountLogin(command)
    }
    this.logins.set(key, login)
    try {
      return {
        status: 'pending',
        loginId: login.id,
        authUrl: await login.flow.ready,
        acceptsCode: true
      }
    } catch (error) {
      await login.flow.cancel()
      if (this.logins.get(key) === login) this.logins.delete(key)
      throw error
    }
  }

  submitCode = async (
    loginId: string,
    code: string,
    options: ProviderSourceOptions = {}
  ): Promise<void> => {
    const login = this.logins.get(getContainerTargetKey(options.container))
    if (!login || login.id !== loginId) throw new Error('Claude sign-in is no longer pending.')
    login.flow.submitCode(code)
  }

  waitForLogin = async (
    accountId: string,
    loginId: string | null,
    options: ProviderSourceOptions = {}
  ): Promise<void> => {
    const key = getContainerTargetKey(options.container)
    const login = this.logins.get(key)
    if (!login || login.id !== loginId || login.accountId !== accountId) {
      throw new Error('Claude sign-in was not found.')
    }
    const result = await login.flow.completion
    if (!result.success) throw new Error(result.error || 'Claude sign-in failed.')
    const store = await this.store(options)
    const expectedId = login.reauthentication
      ? ((await store.getSelection())?.id ?? 'default')
      : (await store.getPending())?.id
    if (this.logins.get(key) !== login || expectedId !== accountId)
      throw new Error('Claude sign-in was canceled.')
    const output = await runClaudeAccountCommand(
      await this.command(['auth', 'status', '--json'], options, login.directory)
    )
    const status = JSON.parse(output) as { loggedIn?: boolean; authMethod?: string }
    if (!status.loggedIn || status.authMethod !== 'claude.ai') {
      throw new Error('Claude did not save a subscription login for this account.')
    }
    if (this.logins.get(key) !== login) throw new Error('Claude sign-in was canceled.')
    login.verified = true
  }

  complete = async (accountId: string, options: ProviderSourceOptions = {}) => {
    const login = this.logins.get(getContainerTargetKey(options.container))
    const store = await this.store(options)
    if (login?.reauthentication && !login.verified)
      throw new Error('Claude sign-in has not been verified.')
    const result =
      login?.accountId === accountId && login.reauthentication
        ? await store.get()
        : await store.complete(accountId)
    this.logins.delete(getContainerTargetKey(options.container))
    return result
  }

  cancel = async (accountId: string, options: ProviderSourceOptions = {}) => {
    const key = getContainerTargetKey(options.container)
    const login = this.logins.get(key)
    if (login?.accountId === accountId) {
      await login.flow.cancel()
      if (this.logins.get(key) === login) this.logins.delete(key)
      if (login.reauthentication) return (await this.store(options)).get()
    }
    const store = await this.store(options)
    // Canceling reauthentication must never remove an existing account's credentials,
    // including a second cancellation racing with the completion request.
    if ((await store.getPending())?.id !== accountId) return store.get()
    return store.cancel(accountId)
  }

  select = async (accountId: string, options: ProviderSourceOptions = {}) => {
    await this.ensureSupported(options)
    return (await this.store(options)).select(accountId)
  }

  remove = async (accountId: string, options: ProviderSourceOptions = {}) =>
    (await this.store(options)).remove(accountId)

  dispose = (): void => {
    for (const login of this.logins.values()) void login.flow.cancel()
    this.logins.clear()
    this.usageFallbacks.clear()
  }
}

export const claudeAccounts = new ClaudeAccounts()
