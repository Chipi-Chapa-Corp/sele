import { createHash, randomUUID } from 'node:crypto'
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

type Login = { id: string; accountId: string; flow: ClaudeAccountLogin }

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

  create = async (name: string, options: ProviderSourceOptions = {}) => {
    await this.ensureSupported(options)
    return (await this.store(options)).create(name)
  }

  getEnvironment = async (container?: AppContainerTarget | null): Promise<NodeJS.ProcessEnv> => {
    const store = await this.store({ container })
    const account = await store.getSelection()
    if (!account) return process.env
    await this.ensureSupported({ container })
    return getClaudeAccountEnvironment(process.env, store.credentialDirectory(account.id))
  }

  getAccountLabel = async (options: ProviderSourceOptions = {}): Promise<string | null> =>
    (await (await this.store(options)).getSelection())?.name ?? null

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
    // The SDK normally caches this endpoint for a minute. Keep the fallback equally
    // bounded, but key it by the actual credentials rather than shared profile data.
    const key = `${getContainerTargetKey(options.container)}:${createHash('sha256').update(token).digest('hex')}`
    for (const [cachedKey, value] of this.usageFallbacks)
      if (value.expiresAt <= Date.now()) this.usageFallbacks.delete(cachedKey)
    const cached = this.usageFallbacks.get(key)
    if (cached) return cached.request
    const request = fetchClaudeRateLimits(token, version)
    this.usageFallbacks.set(key, { request, expiresAt: Date.now() + 60_000 })
    try {
      return await request
    } catch (error) {
      if (this.usageFallbacks.get(key)?.request === request) this.usageFallbacks.delete(key)
      throw error
    }
  }

  login = async (options: ProviderSourceOptions = {}): Promise<ProviderLoginResult | null> => {
    const store = await this.store(options)
    const pending = await store.getPending()
    if (!pending) return null
    const key = getContainerTargetKey(options.container)
    if (this.logins.has(key)) throw new Error('Claude sign-in is already running.')
    const command = await this.command(
      ['auth', 'login', '--claudeai'],
      options,
      store.credentialDirectory(pending.id)
    )
    // Recheck after command resolution, which can involve SSH and shell discovery.
    if ((await store.getPending())?.id !== pending.id || this.logins.has(key)) {
      throw new Error('Claude sign-in is no longer available.')
    }
    const login = { id: randomUUID(), accountId: pending.id, flow: new ClaudeAccountLogin(command) }
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
    if ((await store.getPending())?.id !== accountId)
      throw new Error('Claude sign-in was canceled.')
    const output = await runClaudeAccountCommand(
      await this.command(
        ['auth', 'status', '--json'],
        options,
        store.credentialDirectory(accountId)
      )
    )
    const status = JSON.parse(output) as { loggedIn?: boolean; authMethod?: string }
    if (!status.loggedIn || status.authMethod !== 'claude.ai') {
      throw new Error('Claude did not save a subscription login for this account.')
    }
  }

  complete = async (accountId: string, options: ProviderSourceOptions = {}) => {
    const result = await (await this.store(options)).complete(accountId)
    this.logins.delete(getContainerTargetKey(options.container))
    return result
  }

  cancel = async (accountId: string, options: ProviderSourceOptions = {}) => {
    const key = getContainerTargetKey(options.container)
    const login = this.logins.get(key)
    if (login?.accountId === accountId) {
      await login.flow.cancel()
      if (this.logins.get(key) === login) this.logins.delete(key)
    }
    return (await this.store(options)).cancel(accountId)
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
