import { randomUUID } from 'node:crypto'
import type { ProviderAccountConfiguration } from '../../../shared/provider'

export const claudeDefaultAccountId = 'default'
export const claudeCredentialDirectoryVariable = 'CLAUDE_SECURESTORAGE_CONFIG_DIR'

type Account = { id: string }
type Registry = { activeId: string; accounts: Account[]; pending?: Account }

export type ClaudeAccountStorage = {
  read: () => Promise<string | null>
  write: (value: string) => Promise<void>
  createCredentials: (id: string) => Promise<void>
  removeCredentials: (id: string) => Promise<void>
  credentialDirectory: (id: string) => string
  usageEnvironment: (id: string, env: NodeJS.ProcessEnv) => Promise<NodeJS.ProcessEnv>
  readCredentials: (id: string) => Promise<string | null>
}

export const requireClaudeAccountId = (id: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('Invalid Claude account ID.')
  }
  return id
}

/** Only account IDs and selection live here; Claude owns all credential contents. */
export class ClaudeAccountStore {
  private registry: Registry | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly storage: ClaudeAccountStorage

  constructor(storage: ClaudeAccountStorage) {
    this.storage = storage
  }

  private serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = this.queue.then(run)
    this.queue = result.catch((error: unknown) => {
      console.error('Claude account operation failed.', error)
    })
    return result
  }

  private load = async (): Promise<Registry> => {
    if (this.registry) return this.registry
    const text = await this.storage.read()
    const stored = text ? JSON.parse(text) : { activeId: claudeDefaultAccountId, accounts: [] }
    if (!Array.isArray(stored.accounts)) throw new Error('Invalid Claude account registry.')
    // Discard legacy custom labels without changing IDs, selection, or credentials.
    const value: Registry = {
      activeId: stored.activeId,
      accounts: stored.accounts.map((account: Account) => ({
        id: requireClaudeAccountId(account.id)
      })),
      ...(stored.pending ? { pending: { id: requireClaudeAccountId(stored.pending.id) } } : {})
    }
    if (
      value.activeId !== claudeDefaultAccountId &&
      !value.accounts.some((account) => account.id === value.activeId)
    ) {
      throw new Error(
        'The selected Claude account is missing. Select Default in the account registry.'
      )
    }
    // A pending login from a previous app run never replaces the active account.
    if (value.pending) {
      await this.storage.removeCredentials(value.pending.id)
      delete value.pending
    }
    if (text && JSON.stringify(stored) !== JSON.stringify(value))
      await this.storage.write(JSON.stringify(value))
    this.registry = value
    return value
  }

  private save = async (value: Registry): Promise<void> => {
    await this.storage.write(JSON.stringify(value))
    this.registry = value
  }

  private configuration = (value: Registry): ProviderAccountConfiguration => ({
    available: true,
    unavailableMessage: null,
    accounts: [{ id: claudeDefaultAccountId }, ...value.accounts].map((account) => ({
      ...account,
      active: account.id === value.activeId
    }))
  })

  get = (): Promise<ProviderAccountConfiguration> =>
    this.serialize(async () => this.configuration(await this.load()))

  getSelection = (): Promise<Account | null> =>
    this.serialize(async () => {
      const value = await this.load()
      return value.accounts.find((account) => account.id === value.activeId) ?? null
    })

  getUsageEnvironment = (env: NodeJS.ProcessEnv, accountId?: string): Promise<NodeJS.ProcessEnv> =>
    this.serialize(async () => {
      const value = await this.load()
      const activeId = accountId ?? value.activeId
      if (
        activeId !== claudeDefaultAccountId &&
        !value.accounts.some((account) => account.id === activeId)
      )
        throw new Error('Claude account was not found.')
      return this.storage.usageEnvironment(
        activeId,
        getClaudeAccountEnvironment(
          env,
          activeId === claudeDefaultAccountId ? null : this.credentialDirectory(activeId)
        )
      )
    })

  getUsageAccessToken = (env: NodeJS.ProcessEnv, accountId?: string): Promise<string> =>
    this.serialize(async () => {
      const value = await this.load()
      const activeId = accountId ?? value.activeId
      if (
        activeId !== claudeDefaultAccountId &&
        !value.accounts.some((account) => account.id === activeId)
      )
        throw new Error('Claude account was not found.')
      if (activeId === claudeDefaultAccountId && env.CLAUDE_CODE_OAUTH_TOKEN)
        return env.CLAUDE_CODE_OAUTH_TOKEN
      const content = await this.storage.readCredentials(activeId)
      let credentials: { claudeAiOauth?: { accessToken?: unknown } } | null
      try {
        credentials = content ? JSON.parse(content) : null
      } catch {
        // JSON parse errors can include a fragment of the credential itself.
        throw new Error('Unable to read Claude subscription credentials.')
      }
      const token = credentials?.claudeAiOauth?.accessToken
      if (typeof token !== 'string' || !token)
        throw new Error('Claude subscription credentials are unavailable.')
      return token
    })

  getAccountAccessToken = (id: string, env: NodeJS.ProcessEnv): Promise<string | null> =>
    this.serialize(async () => {
      const value = await this.load()
      if (id !== claudeDefaultAccountId && !value.accounts.some((account) => account.id === id))
        return null
      if (id === claudeDefaultAccountId && env.CLAUDE_CODE_OAUTH_TOKEN)
        return env.CLAUDE_CODE_OAUTH_TOKEN
      const content = await this.storage.readCredentials(id)
      try {
        const token = content ? JSON.parse(content)?.claudeAiOauth?.accessToken : null
        return typeof token === 'string' && token ? token : null
      } catch {
        return null
      }
    })

  getPending = (): Promise<Account | null> =>
    this.serialize(async () => (await this.load()).pending ?? null)

  credentialDirectory = (id: string): string =>
    this.storage.credentialDirectory(requireClaudeAccountId(id))

  create = (): Promise<{ accountId: string }> =>
    this.serialize(async () => {
      const value = await this.load()
      if (value.pending) throw new Error('Finish or cancel the current Claude sign-in first.')
      const pending = { id: randomUUID() }
      await this.storage.createCredentials(pending.id)
      await this.save({ ...value, pending })
      return { accountId: pending.id }
    })

  complete = (id: string): Promise<ProviderAccountConfiguration> =>
    this.serialize(async () => {
      requireClaudeAccountId(id)
      const value = await this.load()
      if (value.pending?.id !== id)
        throw new Error('Claude sign-in was canceled or is no longer pending.')
      const next = { activeId: id, accounts: [...value.accounts, value.pending] }
      await this.save(next)
      return this.configuration(next)
    })

  cancel = (id: string): Promise<ProviderAccountConfiguration> =>
    this.serialize(async () => {
      requireClaudeAccountId(id)
      const value = await this.load()
      if (value.pending?.id !== id) return this.configuration(value)
      await this.storage.removeCredentials(id)
      const next = { activeId: value.activeId, accounts: value.accounts }
      await this.save(next)
      return this.configuration(next)
    })

  select = (id: string): Promise<ProviderAccountConfiguration> =>
    this.serialize(async () => {
      const value = await this.load()
      if (id !== claudeDefaultAccountId && !value.accounts.some((account) => account.id === id)) {
        throw new Error('Claude account was not found.')
      }
      const next = { ...value, activeId: id }
      await this.save(next)
      return this.configuration(next)
    })

  remove = (id: string): Promise<ProviderAccountConfiguration> =>
    this.serialize(async () => {
      requireClaudeAccountId(id)
      const value = await this.load()
      if (!value.accounts.some((account) => account.id === id))
        throw new Error('Claude account was not found.')
      await this.storage.removeCredentials(id)
      const next = {
        ...value,
        activeId: value.activeId === id ? claudeDefaultAccountId : value.activeId,
        accounts: value.accounts.filter((account) => account.id !== id)
      }
      await this.save(next)
      return this.configuration(next)
    })
}

/** Preserve the config/history root and suppress credentials inherited from the launcher. */
export const getClaudeAccountEnvironment = (
  env: NodeJS.ProcessEnv,
  directory: string | null
): NodeJS.ProcessEnv =>
  directory === null
    ? env
    : {
        ...env,
        [claudeCredentialDirectoryVariable]: directory,
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
        CLAUDE_CODE_OAUTH_TOKEN: '',
        CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '',
        ANTHROPIC_API_KEY_FILE_DESCRIPTOR: ''
      }
