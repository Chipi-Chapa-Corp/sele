import { createHash } from 'node:crypto'
import type { ProviderAccountBalance } from '../../../shared/provider'
import { estimateModelCost, type ModelTokenUsage } from '../modelPricing/TokenPricing.ts'

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

/** Adds per-model rates (USD per million tokens) to token usage; missing rates stay unset. */
export type OpenCodeBalancePricing = (models: ModelTokenUsage[]) => Promise<ModelTokenUsage[]>

type BalanceContext = {
  key: string
  admin: boolean
  fetchFn: typeof fetch
  now: number
  priceModels?: OpenCodeBalancePricing
}

type BalanceSource = {
  name: string
  /** Only management/admin keys can read this provider's balance. */
  adminOnly?: boolean
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
  {
    forbiddenIsUnavailable = !admin,
    method = 'GET'
  }: { forbiddenIsUnavailable?: boolean; method?: 'GET' | 'POST' } = {}
): Promise<unknown> => {
  // Keep keys out of errors: only the provider name and HTTP status are reported.
  const response = await fetchFn(url, {
    method,
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

const abliteration: BalanceSource = {
  name: 'abliteration.ai',
  fetch: async (context) => {
    const name = 'abliteration.ai'
    const payload = await requestJson(
      name,
      'https://api.abliteration.ai/v1/credits',
      { authorization: `Bearer ${context.key}` },
      context,
      { forbiddenIsUnavailable: false }
    )
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null
    // Same shape as OpenRouter's credits: purchased total and finalized usage, both in USD.
    const total = toNumber(data?.total_credits)
    const used = toNumber(data?.total_usage)
    if (total == null || used == null) throw invalid(name)
    return [
      balance('abliteration-ai', name, {
        id: 'abliteration-ai:credits',
        label: 'Credits',
        kind: 'remaining',
        amount: total - used,
        currency: 'USD'
      })
    ]
  }
}

const at = (value: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value)

/** Reads a field from the response or from its `data` envelope. */
const read = (payload: unknown, path: string): unknown =>
  at(payload, path) ?? at(payload, `data.${path}`)
const readNumber = (payload: unknown, path: string): number | null => toNumber(read(payload, path))

type SimpleAmount = Omit<ProviderAccountBalance, 'id' | 'modelProviderId' | 'modelProviderName'>
const credits = (amount: number | null, currency = 'USD'): SimpleAmount[] | null =>
  amount == null ? null : [{ label: 'Credits', kind: 'remaining', amount, currency }]

/**
 * A provider whose documented billing endpoint returns its balance in one request.
 * `read` returns null when the response does not have the documented fields.
 */
const simple = (
  providerId: string,
  name: string,
  url: string,
  readAmounts: (payload: unknown) => SimpleAmount[] | null,
  {
    adminOnly = false,
    header = 'bearer',
    method,
    forbiddenIsUnavailable = false
  }: {
    adminOnly?: boolean
    header?: 'bearer' | 'x-api-key'
    method?: 'GET' | 'POST'
    /** Keys may lack the billing permission; hide the balance instead of reporting an error. */
    forbiddenIsUnavailable?: boolean
  } = {}
): BalanceSource => ({
  name,
  adminOnly,
  fetch: async (context) => {
    const payload = await requestJson(
      name,
      url,
      header === 'bearer'
        ? { authorization: `Bearer ${context.key}` }
        : { 'x-api-key': context.key },
      context,
      { forbiddenIsUnavailable, method }
    )
    const amounts = readAmounts(payload)
    if (!amounts) throw invalid(name)
    return amounts.map((amount, index) =>
      balance(providerId, name, { ...amount, id: `${providerId}:${index}` })
    )
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
    let reportedUntil = Date.parse(startingAt)
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
        const endingAt = toTimestamp(bucket.ending_at)
        if (endingAt != null) reportedUntil = Math.max(reportedUntil, endingAt)
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
    // The cost report only has finished UTC days. Price the rest from the hourly token report.
    const recent = await estimateAnthropicRecentCost(context, reportedUntil)
    return [
      balance('anthropic', name, {
        id: 'anthropic:month',
        label: 'This month (organization)',
        kind: 'spent',
        amount: cents / 100 + (recent ?? 0),
        estimatedAmount: recent,
        currency,
        resetsAt: startOfNextUtcMonth(context.now)
      })
    ]
  }
}

/** Estimated USD spend since `since`, or null when there is no usage to price or no pricing. */
const estimateAnthropicRecentCost = async (
  context: BalanceContext,
  since: number
): Promise<number | null> => {
  if (!context.priceModels || since >= context.now) return null
  const name = 'Anthropic'
  const models = new Map<string, ModelTokenUsage>()
  let page: string | null = null
  for (let index = 0; index < maxCostPages; index += 1) {
    const query = new URLSearchParams({
      starting_at: new Date(since).toISOString(),
      bucket_width: '1h',
      limit: '168'
    })
    query.append('group_by[]', 'model')
    if (page) query.set('page', page)
    const payload = await requestJson(
      name,
      `https://api.anthropic.com/v1/organizations/usage_report/messages?${query}`,
      { 'x-api-key': context.key, 'anthropic-version': '2023-06-01' },
      context
    )
    if (!isRecord(payload) || !Array.isArray(payload.data)) throw invalid(name)
    for (const bucket of payload.data) {
      if (!isRecord(bucket) || !Array.isArray(bucket.results)) continue
      for (const result of bucket.results) {
        if (!isRecord(result) || typeof result.model !== 'string') continue
        const cache = isRecord(result.cache_creation) ? result.cache_creation : {}
        const write5m = toNumber(cache.ephemeral_5m_input_tokens) ?? 0
        const write1h = toNumber(cache.ephemeral_1h_input_tokens) ?? 0
        const model = models.get(result.model) ?? {
          modelId: result.model,
          pricingProvider: 'anthropic',
          usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
          cacheWriteTokens: 0,
          cacheWrite1hTokens: 0
        }
        // Sele's token model counts cache writes as input tokens.
        model.usage.inputTokens += (toNumber(result.uncached_input_tokens) ?? 0) + write5m + write1h
        model.usage.cachedInputTokens += toNumber(result.cache_read_input_tokens) ?? 0
        model.usage.outputTokens += toNumber(result.output_tokens) ?? 0
        model.cacheWriteTokens = (model.cacheWriteTokens ?? 0) + write5m + write1h
        model.cacheWrite1hTokens = (model.cacheWrite1hTokens ?? 0) + write1h
        models.set(result.model, model)
      }
    }
    page =
      payload.has_more === true && typeof payload.next_page === 'string' ? payload.next_page : null
    if (!page) break
  }
  if (models.size === 0) return null
  let total = 0
  let priced = false
  for (const model of await context.priceModels([...models.values()])) {
    const cost = estimateModelCost(model).total
    if (cost == null) continue
    total += cost
    priced = true
  }
  return priced ? total : null
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
  'abliteration-ai': abliteration,
  anthropic,
  openai: openAi,
  aiand: simple('aiand', 'ai&', 'https://api.aiand.com/billing/balance', (payload) => {
    const currency = read(payload, 'currency')
    return credits(
      readNumber(payload, 'balance'),
      typeof currency === 'string' ? currency.toUpperCase() : 'USD'
    )
  }),
  aimlapi: simple('aimlapi', 'AI/ML API', 'https://api.aimlapi.com/v2/billing', (payload) =>
    credits(readNumber(payload, 'current_balance'))
  ),
  coralbricks: simple(
    'coralbricks',
    'CoralBricks',
    'https://inference.coralbricks.ai/v1/quota',
    (payload) => credits(readNumber(payload, 'balance'))
  ),
  crossmodel: simple(
    'crossmodel',
    'CrossModel',
    'https://api.crossmodel.ai/v1/credits',
    (payload) => {
      const micro = readNumber(payload, 'balance_micro')
      return credits(micro == null ? null : micro / 1_000_000)
    }
  ),
  // A negative Stripe balance is money ready to spend; a positive one is money owed.
  deepinfra: simple(
    'deepinfra',
    'Deep Infra',
    'https://api.deepinfra.com/payment/checklist',
    (payload) => {
      const stripe = readNumber(payload, 'stripe_balance')
      return credits(stripe == null ? null : -stripe)
    }
  ),
  empiriolabs: simple(
    'empiriolabs',
    'EmpirioLabs AI',
    'https://api.empiriolabs.ai/v1/account/usage',
    (payload) => {
      const currency = read(payload, 'balance.currency')
      return credits(
        readNumber(payload, 'balance.amount'),
        typeof currency === 'string' ? currency.toUpperCase() : 'USD'
      )
    }
  ),
  frogbot: simple('frogbot', 'FrogBot', 'https://app.frogbot.ai/api/v1/quota', (payload) =>
    credits(readNumber(payload, 'balanceUSD'))
  ),
  impossibl: simple('impossibl', 'Impossibl', 'https://api.impossibl.com/v1/account', (payload) =>
    credits(readNumber(payload, 'balance.usd'))
  ),
  // Keys with model, spend or token restrictions cannot read the balance.
  kenari: simple(
    'kenari',
    'Kenari',
    'https://kenari.id/v1/account/balance',
    (payload) => {
      const micro = readNumber(payload, 'available_micro_idr')
      return credits(micro == null ? null : micro / 1_000_000, 'IDR')
    },
    { forbiddenIsUnavailable: true }
  ),
  llmgateway: llmGateway('llmgateway', 'DevPass (LLM Gateway)'),
  'llmgateway-providers': llmGateway('llmgateway-providers', 'LLM Gateway'),
  meganova: simple(
    'meganova',
    'Meganova',
    'https://api.meganova.ai/api/v1/users/credits',
    (payload) => credits(readNumber(payload, 'available_balance'))
  ),
  neuralwatt: simple('neuralwatt', 'Neuralwatt', 'https://api.neuralwatt.com/v1/quota', (payload) =>
    credits(readNumber(payload, 'balance.credits_remaining_usd'))
  ),
  // Amounts are strings in 1/10,000 USD.
  'novita-ai': simple(
    'novita-ai',
    'Novita AI',
    'https://api.novita.ai/openapi/v1/billing/balance/detail',
    (payload) => {
      const units = readNumber(payload, 'availableBalance')
      return credits(units == null ? null : units / 10_000)
    }
  ),
  ofox: simple('ofox', 'Ofox', 'https://api.ofox.ai/v1/user/balance', (payload) => {
    const currency = read(payload, 'currency')
    return credits(
      readNumber(payload, 'balance'),
      typeof currency === 'string' ? currency.toUpperCase() : 'USD'
    )
  }),
  'ollama-cloud': simple(
    'ollama-cloud',
    'Ollama Cloud',
    'https://ollama.com/api/balance',
    (payload) => {
      const included = readNumber(payload, 'included.balance_usd')
      const purchased = readNumber(payload, 'purchased.balance_usd')
      return included == null && purchased == null
        ? null
        : credits((included ?? 0) + (purchased ?? 0))
    }
  ),
  orcarouter: simple(
    'orcarouter',
    'OrcaRouter',
    'https://api.orcarouter.ai/v1/tools/balance',
    (payload) => credits(readNumber(payload, 'spendable_usd'))
  ),
  pareto: simple(
    'pareto',
    'Pareto Inference',
    'https://api.paretoinference.com/v1/balance',
    (payload) => credits(readNumber(payload, 'balance'))
  ),
  poe: simple('poe', 'Poe', 'https://api.poe.com/usage/current_balance', (payload) =>
    credits(readNumber(payload, 'current_point_balance'), 'points')
  ),
  prime: simple(
    'prime',
    'Prime Inference',
    'https://api.primeintellect.ai/api/v1/billing/wallet',
    (payload) => credits(readNumber(payload, 'balance_usd')),
    { forbiddenIsUnavailable: true }
  ),
  requesty: simple(
    'requesty',
    'Requesty',
    'https://api-v2.requesty.ai/v1/manage/apikey/self',
    (payload) => {
      const spent = readNumber(payload, 'monthly_spend')
      const limit = readNumber(payload, 'monthly_limit')
      if (spent == null) return null
      return [
        {
          label: 'This month (key)',
          kind: 'spent',
          amount: spent,
          // Zero means the key has no monthly limit.
          limit: limit && limit > 0 ? limit : null,
          currency: 'USD'
        }
      ]
    }
  ),
  runinfra: simple('runinfra', 'RunInfra', 'https://api.runinfra.ai/v1/credits', (payload) => {
    const cents = readNumber(payload, 'available_cents')
    return credits(cents == null ? null : cents / 100)
  }),
  stepfun: simple('stepfun', 'StepFun (China)', 'https://api.stepfun.com/v1/accounts', (payload) =>
    credits(readNumber(payload, 'balance'), 'CNY')
  ),
  'stepfun-ai': simple(
    'stepfun-ai',
    'StepFun (Global)',
    'https://api.stepfun.ai/v1/accounts',
    (payload) => credits(readNumber(payload, 'balance'))
  ),
  'umans-ai': simple(
    'umans-ai',
    'Umans AI',
    'https://app.umans.ai/api/v1/wallet/summary',
    (payload) => {
      const cents = readNumber(payload, 'balance.balanceCents')
      return credits(cents == null ? null : cents / 100)
    }
  ),
  // Quota units: 500,000 = $1.
  unorouter: simple(
    'unorouter',
    'UnoRouter',
    'https://api.unorouter.com/api/usage/token/',
    (payload) => {
      const units = readNumber(payload, 'total_available')
      return credits(units == null ? null : units / 500_000)
    }
  ),
  venice: simple('venice', 'Venice AI', 'https://api.venice.ai/api/v1/billing/balance', (payload) =>
    credits(readNumber(payload, 'balances.usd'))
  ),
  vercel: simple(
    'vercel',
    'Vercel AI Gateway',
    'https://ai-gateway.vercel.sh/v1/credits',
    (payload) => credits(readNumber(payload, 'balance'))
  ),
  'nano-gpt': simple(
    'nano-gpt',
    'NanoGPT',
    'https://nano-gpt.com/api/check-balance',
    (payload) => credits(readNumber(payload, 'usd_balance')),
    { header: 'x-api-key', method: 'POST' }
  ),
  // The organization balance is only included when the key's owner may read billing.
  opper: simple(
    'opper',
    'Opper',
    'https://api.opper.ai/v3/me',
    (payload) => {
      if (!isRecord(payload)) return null
      const cents = readNumber(payload, 'balance.balance_cents')
      return cents == null ? [] : credits(cents / 100)
    },
    { forbiddenIsUnavailable: true }
  ),
  // Management keys only; inference keys are rejected by these endpoints.
  aihubmix: simple(
    'aihubmix',
    'AIHubMix',
    'https://aihubmix.com/api/user/self',
    (payload) => {
      // Quota units: 500,000 = $1.
      const units = readNumber(payload, 'quota')
      return credits(units == null ? null : units / 500_000)
    },
    { adminOnly: true }
  ),
  cortecs: simple(
    'cortecs',
    'Cortecs',
    'https://api.cortecs.ai/v1/manage/balance',
    (payload) => {
      const currency = read(payload, 'currency')
      return credits(
        readNumber(payload, 'current_balance'),
        typeof currency === 'string' ? currency.toUpperCase() : 'USD'
      )
    },
    { adminOnly: true }
  ),
  'merge-gateway': simple(
    'merge-gateway',
    'Merge Gateway',
    'https://api-gateway.merge.dev/v1/credits',
    (payload) => credits(readNumber(payload, 'balance_usd')),
    { adminOnly: true }
  ),
  zenmux: simple(
    'zenmux',
    'ZenMux',
    'https://zenmux.ai/api/v1/management/payg/balance',
    (payload) => credits(readNumber(payload, 'total_credits')),
    { adminOnly: true }
  )
}

function llmGateway(providerId: string, name: string): BalanceSource {
  return simple(providerId, name, 'https://api.llmgateway.io/v1/key', (payload) => {
    if (!isRecord(payload)) return null
    const plan = read(payload, 'devPlan')
    if (typeof plan === 'string' && plan !== 'none') {
      const used = readNumber(payload, 'devPlanCreditsUsed')
      const limit = readNumber(payload, 'devPlanCreditsLimit')
      if (used != null && limit != null)
        return [
          { label: 'DevPass this cycle', kind: 'spent', amount: used, limit, currency: 'USD' }
        ]
    }
    const usage = readNumber(payload, 'usage')
    const limit = readNumber(payload, 'limit')
    // Without a plan or a key limit, only lifetime spend is reported; nothing useful to show.
    return usage != null && limit != null && limit > 0
      ? [{ label: 'Key limit', kind: 'spent', amount: usage, limit, currency: 'USD' }]
      : []
  })
}

/**
 * Environment variables OpenCode reads each provider's key from. Providers that share a
 * variable across regions (Moonshot) are left out because the region cannot be inferred.
 */
const openCodeBalanceEnvironmentKeys: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  'abliteration-ai': 'ABLIT_KEY',
  aiand: 'AIAND_API_KEY',
  aimlapi: 'AIMLAPI_API_KEY',
  coralbricks: 'CORAL_API_KEY',
  crossmodel: 'CROSSMODEL_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  empiriolabs: 'EMPIRIOLABS_API_KEY',
  frogbot: 'FROGBOT_API_KEY',
  impossibl: 'IMPOSSIBL_API_KEY',
  kenari: 'KENARI_API_KEY',
  // Both LLM Gateway providers read this variable; report its balance once.
  llmgateway: 'LLMGATEWAY_API_KEY',
  meganova: 'MEGANOVA_API_KEY',
  neuralwatt: 'NEURALWATT_API_KEY',
  'novita-ai': 'NOVITA_API_KEY',
  ofox: 'OFOX_API_KEY',
  'ollama-cloud': 'OLLAMA_API_KEY',
  orcarouter: 'ORCAROUTER_API_KEY',
  pareto: 'PARETO_API_KEY',
  poe: 'POE_API_KEY',
  prime: 'PRIME_API_KEY',
  requesty: 'REQUESTY_API_KEY',
  runinfra: 'RUNINFRA_GATEWAY_KEY',
  'umans-ai': 'UMANS_AI_API_KEY',
  unorouter: 'UNOROUTER_API_KEY',
  venice: 'VENICE_API_KEY',
  vercel: 'AI_GATEWAY_API_KEY',
  'nano-gpt': 'NANO_GPT_API_KEY',
  opper: 'OPPER_API_KEY',
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
    else if (key && !openCodeBalanceSources[providerId]?.adminOnly)
      selected[providerId] = { key, admin: false }
  }
  return selected
}

export const fetchOpenCodeBalance = async (
  providerId: string,
  { key, admin }: OpenCodeBalanceKey,
  fetchFn: typeof fetch = fetch,
  now = Date.now(),
  priceModels?: OpenCodeBalancePricing
): Promise<ProviderAccountBalance[]> => {
  const source = openCodeBalanceSources[providerId]
  if (!source) throw new OpenCodeBalanceUnavailableError(providerId)
  return source.fetch({ key, admin, fetchFn, now, priceModels })
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
  private readonly priceModels: OpenCodeBalancePricing | undefined

  constructor(
    fetchFn: typeof fetch = fetch,
    clock: () => number = Date.now,
    priceModels?: OpenCodeBalancePricing
  ) {
    this.fetchFn = fetchFn
    this.clock = clock
    this.priceModels = priceModels
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
    const request = fetchOpenCodeBalance(providerId, key, this.fetchFn, now, this.priceModels)
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
