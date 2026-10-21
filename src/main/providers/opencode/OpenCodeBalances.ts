import { createHash } from 'node:crypto'
import type { ProviderAccountBalance } from '../../../shared/provider'

const balanceRequestTimeoutMs = 15_000
const successCacheMs = 60_000
const unavailableCacheMs = 60 * 60_000
const maxCostPages = 4

/**
 * The key cannot read billing data (for example an inference key on an admin-only endpoint).
 * Balances that are impossible to read are hidden rather than reported as errors.
 */
export class OpenCodeBalanceUnavailableError extends Error {
  constructor(providerName: string) {
    super(`${providerName} does not report a balance for this key.`)
    this.name = 'OpenCodeBalanceUnavailableError'
  }
}

export type OpenCodeBalanceKey = { key: string; admin: boolean }

type BalanceContext = {
  key: string
  admin: boolean
  fetchFn: typeof fetch
  now: number
}

type BalanceSource = {
  name: string
  fetch: (context: BalanceContext) => Promise<ProviderAccountBalance[]>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toNumber = (value: unknown): number | null => {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN
  return Number.isFinite(number) ? number : null
}

const toTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

const startOfUtcMonth = (now: number): Date => {
  const date = new Date(now)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

const startOfNextUtcMonth = (now: number): number => {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
}

const requestJson = async (
  name: string,
  url: string,
  headers: Record<string, string>,
  { fetchFn, admin }: BalanceContext,
  { forbiddenIsUnavailable = !admin }: { forbiddenIsUnavailable?: boolean } = {}
): Promise<unknown> => {
  // Keep keys out of errors: only the provider name and HTTP status are reported.
  const response = await fetchFn(url, {
    headers: { accept: 'application/json', 'user-agent': 'sele', ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(balanceRequestTimeoutMs)
  }).catch(() => {
    throw new Error(`${name} balance request failed.`)
  })
  if (
    (response.status === 401 || response.status === 403 || response.status === 404) &&
    forbiddenIsUnavailable
  )
    throw new OpenCodeBalanceUnavailableError(name)
  if (response.status === 401 || response.status === 403)
    throw new Error(`${name} rejected the ${admin ? 'admin ' : ''}key used for its balance.`)
  if (!response.ok)
    throw new Error(`${name} balance request failed with status ${response.status}.`)
  try {
    return await response.json()
  } catch {
    throw new Error(`${name} returned an invalid balance response.`)
  }
}

const invalid = (name: string): Error => new Error(`${name} returned an invalid balance response.`)

const balance = (
  providerId: string,
  name: string,
  value: Omit<ProviderAccountBalance, 'modelProviderId' | 'modelProviderName'>
): ProviderAccountBalance => ({ ...value, modelProviderId: providerId, modelProviderName: name })

const openRouter: BalanceSource = {
  name: 'OpenRouter',
  fetch: async (context) => {
    const name = 'OpenRouter'
    if (context.admin) {
      // Management keys read the account's credits but cannot run models.
      const payload = await requestJson(
        name,
        'https://openrouter.ai/api/v1/credits',
        { authorization: `Bearer ${context.key}` },
        context
      )
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
      const total = toNumber(data?.total_credits)
      const used = toNumber(data?.total_usage)
      if (total == null || used == null) throw invalid(name)
      return [
        balance('openrouter', name, {
          id: 'openrouter:credits',
          label: 'Credits',
          kind: 'remaining',
          amount: total - used,
          currency: 'USD'
        })
      ]
    }
    const payload = await requestJson(
      name,
      'https://openrouter.ai/api/v1/key',
      { authorization: `Bearer ${context.key}` },
      context,
      { forbiddenIsUnavailable: false }
    )
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
    if (!data) throw invalid(name)
    const balances: ProviderAccountBalance[] = []
    const limit = toNumber(data.limit)
    const remaining = toNumber(data.limit_remaining)
    if (limit != null && remaining != null) {
      const reset = typeof data.limit_reset === 'string' ? data.limit_reset : null
      balances.push(
        balance('openrouter', name, {
          id: 'openrouter:key-limit',
          label: reset ? `Key limit (${reset})` : 'Key limit',
          kind: 'spent',
          amount: Math.max(0, limit - remaining),
          limit,
          currency: 'USD'
        })
      )
    }
    const budget = isRecord(data.effective_budget) ? data.effective_budget : null
    const budgetLimit = toNumber(budget?.limit_usd)
    const budgetSpend = toNumber(budget?.spend_usd)
    if (budget && budget.scope !== 'key_limit' && budgetLimit != null && budgetSpend != null) {
      const interval = typeof budget.reset_interval === 'string' ? budget.reset_interval : null
      balances.push(
        balance('openrouter', name, {
          id: 'openrouter:budget',
          label: interval ? `Budget (${interval})` : 'Budget',
          kind: 'spent',
          amount: budgetSpend,
          limit: budgetLimit,
          currency: 'USD',
          resetsAt: toTimestamp(budget.resets_at)
        })
      )
    }
    const monthly = toNumber(data.usage_monthly)
    if (monthly != null)
      balances.push(
        balance('openrouter', name, {
          id: 'openrouter:month',
          label: 'This month',
          kind: 'spent',
          amount: monthly,
          currency: 'USD',
          resetsAt: startOfNextUtcMonth(context.now)
        })
      )
    return balances
  }
}

const deepSeek: BalanceSource = {
  name: 'DeepSeek',
  fetch: async (context) => {
    const name = 'DeepSeek'
    const payload = await requestJson(
      name,
      'https://api.deepseek.com/user/balance',
      { authorization: `Bearer ${context.key}` },
      context,
      { forbiddenIsUnavailable: false }
    )
    if (!isRecord(payload) || !Array.isArray(payload.balance_infos)) throw invalid(name)
    return payload.balance_infos.flatMap((info) => {
      if (!isRecord(info)) return []
      const amount = toNumber(info.total_balance)
      const currency = typeof info.currency === 'string' ? info.currency.toUpperCase() : null
      if (amount == null || !currency) return []
      return [
        balance('deepseek', name, {
          id: `deepseek:${currency}`,
          label: 'Balance',
          kind: 'remaining',
          amount,
          currency
        })
      ]
    })
  }
}

const moonshot = (
  providerId: string,
  name: string,
  host: string,
  currency: string
): BalanceSource => ({
  name,
  fetch: async (context) => {
    const payload = await requestJson(
      name,
      `https://${host}/v1/users/me/balance`,
      { authorization: `Bearer ${context.key}` },
      context,
      { forbiddenIsUnavailable: false }
    )
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
    const amount = toNumber(data?.available_balance)
    if (amount == null) throw invalid(name)
    return [
      balance(providerId, name, {
        id: `${providerId}:balance`,
        label: 'Balance',
        kind: 'remaining',
        amount,
        currency
      })
    ]
  }
})

const siliconFlow = (
  providerId: string,
  name: string,
  host: string,
  currency: string
): BalanceSource => ({
  name,
  fetch: async (context) => {
    const payload = await requestJson(
      name,
      `https://${host}/v1/user/info`,
      { authorization: `Bearer ${context.key}` },
      context,
      { forbiddenIsUnavailable: false }
    )
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
    const amount = toNumber(data?.totalBalance) ?? toNumber(data?.balance)
    if (amount == null) throw invalid(name)
    return [
      balance(providerId, name, {
        id: `${providerId}:balance`,
        label: 'Balance',
        kind: 'remaining',
        amount,
        currency
      })
    ]
  }
})

const anthropic: BalanceSource = {
  name: 'Anthropic',
  fetch: async (context) => {
    const name = 'Anthropic'
    const startingAt = startOfUtcMonth(context.now).toISOString()
    let page: string | null = null
    let cents = 0
    let currency = 'USD'
    for (let index = 0; index < maxCostPages; index += 1) {
      const query = new URLSearchParams({
        starting_at: startingAt,
        bucket_width: '1d',
        limit: '31'
      })
      if (page) query.set('page', page)
      const payload = await requestJson(
        name,
        `https://api.anthropic.com/v1/organizations/cost_report?${query}`,
        { 'x-api-key': context.key, 'anthropic-version': '2023-06-01' },
        context
      )
      if (!isRecord(payload) || !Array.isArray(payload.data)) throw invalid(name)
      for (const bucket of payload.data) {
        if (!isRecord(bucket) || !Array.isArray(bucket.results)) continue
        for (const result of bucket.results) {
          if (!isRecord(result)) continue
          // Amounts are decimal strings in the lowest currency unit (cents).
          const amount = toNumber(result.amount)
          if (amount != null) cents += amount
          if (typeof result.currency === 'string') currency = result.currency.toUpperCase()
        }
      }
      page =
        payload.has_more === true && typeof payload.next_page === 'string'
          ? payload.next_page
          : null
      if (!page) break
    }
    return [
      balance('anthropic', name, {
        id: 'anthropic:month',
        label: 'Organization this month',
        kind: 'spent',
        amount: cents / 100,
        currency,
        resetsAt: startOfNextUtcMonth(context.now)
      })
    ]
  }
}

const openAi: BalanceSource = {
  name: 'OpenAI',
  fetch: async (context) => {
    const name = 'OpenAI'
    const startTime = Math.floor(startOfUtcMonth(context.now).getTime() / 1_000)
    let page: string | null = null
    let total = 0
    let currency = 'USD'
    for (let index = 0; index < maxCostPages; index += 1) {
      const query = new URLSearchParams({
        start_time: String(startTime),
        bucket_width: '1d',
        limit: '31'
      })
      if (page) query.set('page', page)
      const payload = await requestJson(
        name,
        `https://api.openai.com/v1/organization/costs?${query}`,
        { authorization: `Bearer ${context.key}` },
        context
      )
      if (!isRecord(payload) || !Array.isArray(payload.data)) throw invalid(name)
      for (const bucket of payload.data) {
        if (!isRecord(bucket) || !Array.isArray(bucket.results)) continue
        for (const result of bucket.results) {
          const amount = isRecord(result) && isRecord(result.amount) ? result.amount : null
          const value = toNumber(amount?.value)
          if (value != null) total += value
          if (typeof amount?.currency === 'string') currency = amount.currency.toUpperCase()
        }
      }
      page =
        payload.has_more === true && typeof payload.next_page === 'string'
          ? payload.next_page
          : null
      if (!page) break
    }
    return [
      balance('openai', name, {
        id: 'openai:month',
        label: 'Organization this month',
        kind: 'spent',
        amount: total,
        currency,
        resetsAt: startOfNextUtcMonth(context.now)
      })
    ]
  }
}

/** Billing endpoints by OpenCode provider ID (the models.dev catalog ID). */
export const openCodeBalanceSources: Record<string, BalanceSource> = {
  openrouter: openRouter,
  deepseek: deepSeek,
  moonshotai: moonshot('moonshotai', 'Moonshot AI', 'api.moonshot.ai', 'USD'),
  'moonshotai-cn': moonshot('moonshotai-cn', 'Moonshot AI (China)', 'api.moonshot.cn', 'CNY'),
  siliconflow: siliconFlow('siliconflow', 'SiliconFlow', 'api.siliconflow.com', 'USD'),
  'siliconflow-cn': siliconFlow(
    'siliconflow-cn',
    'SiliconFlow (China)',
    'api.siliconflow.cn',
    'CNY'
  ),
  anthropic,
  openai: openAi
}

/**
 * Environment variables OpenCode reads each provider's key from. Providers that share a
 * variable across regions (Moonshot) are left out because the region cannot be inferred.
 */
const openCodeBalanceEnvironmentKeys: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  'siliconflow-cn': 'SILICONFLOW_CN_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY'
}

export const getOpenCodeEnvironmentApiKeys = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const keys: Record<string, string> = {}
  for (const [providerId, name] of Object.entries(openCodeBalanceEnvironmentKeys)) {
    const value = env[name]?.trim()
    if (value) keys[providerId] = value
  }
  return keys
}

/**
 * Picks the key to read each provider's balance with. Saved admin keys win; otherwise the
 * inference key OpenCode uses is tried, since some providers accept it for billing reads.
 */
export const selectOpenCodeBalanceKeys = (
  apiKeys: Record<string, string>,
  adminKeys: Record<string, string>
): Record<string, OpenCodeBalanceKey> => {
  const selected: Record<string, OpenCodeBalanceKey> = {}
  for (const providerId of Object.keys(openCodeBalanceSources)) {
    const admin = adminKeys[providerId]
    const key = apiKeys[providerId]
    if (admin) selected[providerId] = { key: admin, admin: true }
    else if (key) selected[providerId] = { key, admin: false }
  }
  return selected
}

export const fetchOpenCodeBalance = async (
  providerId: string,
  { key, admin }: OpenCodeBalanceKey,
  fetchFn: typeof fetch = fetch,
  now = Date.now()
): Promise<ProviderAccountBalance[]> => {
  const source = openCodeBalanceSources[providerId]
  if (!source) throw new OpenCodeBalanceUnavailableError(providerId)
  return source.fetch({ key, admin, fetchFn, now })
}

type CacheEntry =
  | { expiresAt: number; state: 'ready'; balances: ProviderAccountBalance[] }
  | { expiresAt: number; state: 'unavailable' }

export type OpenCodeBalanceResult = {
  balances: ProviderAccountBalance[]
  errors: string[]
}

/** Caches balance reads so frequent usage refreshes stay within provider polling limits. */
export class OpenCodeBalanceCache {
  private entries = new Map<string, CacheEntry>()
  private running = new Map<string, Promise<ProviderAccountBalance[]>>()
  private readonly fetchFn: typeof fetch
  private readonly clock: () => number

  constructor(fetchFn: typeof fetch = fetch, clock: () => number = Date.now) {
    this.fetchFn = fetchFn
    this.clock = clock
  }

  private cacheKey = (providerId: string, key: OpenCodeBalanceKey): string =>
    `${providerId}\0${key.admin ? 'admin' : 'api'}\0${createHash('sha256').update(key.key).digest('hex')}`

  private load = (
    providerId: string,
    key: OpenCodeBalanceKey,
    forceRefresh: boolean
  ): Promise<ProviderAccountBalance[]> => {
    const cacheKey = this.cacheKey(providerId, key)
    const now = this.clock()
    const cached = this.entries.get(cacheKey)
    if (cached && cached.expiresAt > now && (cached.state === 'unavailable' || !forceRefresh)) {
      if (cached.state === 'unavailable')
        return Promise.reject(new OpenCodeBalanceUnavailableError(providerId))
      return Promise.resolve(cached.balances)
    }
    const running = this.running.get(cacheKey)
    if (running) return running
    const request = fetchOpenCodeBalance(providerId, key, this.fetchFn, now)
      .then((balances) => {
        this.entries.set(cacheKey, {
          expiresAt: this.clock() + successCacheMs,
          state: 'ready',
          balances
        })
        return balances
      })
      .catch((error: unknown) => {
        if (error instanceof OpenCodeBalanceUnavailableError)
          this.entries.set(cacheKey, {
            expiresAt: this.clock() + unavailableCacheMs,
            state: 'unavailable'
          })
        else this.entries.delete(cacheKey)
        throw error
      })
      .finally(() => this.running.delete(cacheKey))
    this.running.set(cacheKey, request)
    return request
  }

  /** Forgets cached reads, e.g. after a key is added or removed. */
  clear = (): void => this.entries.clear()

  get = async (
    keys: Record<string, OpenCodeBalanceKey>,
    { forceRefresh = false }: { forceRefresh?: boolean } = {}
  ): Promise<OpenCodeBalanceResult> => {
    const providerIds = Object.keys(keys)
    const results = await Promise.allSettled(
      providerIds.map((providerId) => this.load(providerId, keys[providerId]!, forceRefresh))
    )
    const balances: ProviderAccountBalance[] = []
    const errors: string[] = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') balances.push(...result.value)
      else if (!(result.reason instanceof OpenCodeBalanceUnavailableError)) {
        console.error(
          '[OpenCodeBalanceCache] Unable to load balance',
          providerIds[index],
          result.reason
        )
        errors.push(result.reason instanceof Error ? result.reason.message : 'Balance unavailable.')
      }
    })
    return { balances, errors }
  }
}

/** Checks a newly entered admin key before it is saved. */
export const verifyOpenCodeAdminKey = async (
  providerId: string,
  key: string,
  fetchFn: typeof fetch = fetch
): Promise<void> => {
  const source = openCodeBalanceSources[providerId]
  if (!source) throw new Error('This provider does not support admin keys.')
  try {
    await fetchOpenCodeBalance(providerId, { key, admin: true }, fetchFn)
  } catch (error) {
    if (error instanceof OpenCodeBalanceUnavailableError)
      throw new Error(`${source.name} did not accept this key for usage data.`)
    throw error
  }
}
