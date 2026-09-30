import type { ProviderChatItem } from './provider.ts'

/** Disjoint spend categories. Cache writes count as input; reasoning counts as output. */
export type TokenUsage = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  cost?: TokenCost
  /** Some prices use a fallback model because the historical model was not recorded. */
  costUsesFallback?: boolean
}

/** Null means that a provider/rate is unavailable, never a zero-dollar estimate. */
export type TokenCost = {
  input: number | null
  cachedInput: number | null
  output: number | null
  total: number | null
}

/** Model prices blended using recorded token weights, or the provider default when empty. */
export type TokenCostSample = { tokens: number; usdPerMillionTokens: number }

export const aggregateTokenCostAssumptions: TokenUsage = {
  inputTokens: 10_000,
  cachedInputTokens: 950_000,
  outputTokens: 40_000
}

export const extrapolateTokenCost = (
  tokens: string | null,
  sample: TokenCostSample | null
): { costUSD: number | null; sample: TokenCostSample | null } => {
  const count = tokens != null && /^\d+$/.test(tokens) ? Number(tokens) : NaN
  if (!Number.isSafeInteger(count) || count < 0) return { costUSD: null, sample: null }
  if (count === 0) return { costUSD: 0, sample: null }
  if (!sample || !Number.isFinite(sample.usdPerMillionTokens) || sample.usdPerMillionTokens < 0)
    return { costUSD: null, sample: null }
  const costUSD = (count / 1_000_000) * sample.usdPerMillionTokens
  return Number.isFinite(costUSD) ? { costUSD, sample } : { costUSD: null, sample: null }
}

export const formatTokenCostEstimateTitle = (
  costUSD: number | null | undefined,
  sample: TokenCostSample | null | undefined,
  recordedTitle: string
): string => {
  if (costUSD == null)
    return 'Cost unavailable: model pricing is not available for this provider and source.'
  if (!sample) return recordedTitle
  return `Approximate cost: assumes 95% cached input, 4% output, and 1% input. Total tokens × $${formatUsageDollars(sample.usdPerMillionTokens)} per million tokens. ${sample.tokens > 0 ? `Uses saved model rates weighted by ${sample.tokens.toLocaleString('en')} recorded tokens.` : 'Uses the provider’s default model price.'}`
}

export const getTokenCost = (usage: TokenUsage): TokenCost =>
  usage.cost ?? {
    input: usage.inputTokens > 0 ? null : 0,
    cachedInput: usage.cachedInputTokens > 0 ? null : 0,
    output: usage.outputTokens > 0 ? null : 0,
    total: totalTokenUsage(usage) > 0 ? null : 0
  }

const combineCosts = (
  first: TokenUsage,
  second: TokenUsage,
  combine: (first: number, second: number) => number
): Pick<TokenUsage, 'cost' | 'costUsesFallback'> => {
  if (!first.cost && !second.cost) return {}
  const a = getTokenCost(first)
  const b = getTokenCost(second)
  return {
    ...(first.costUsesFallback || second.costUsesFallback ? { costUsesFallback: true } : {}),
    cost: Object.fromEntries(
      (['input', 'cachedInput', 'output', 'total'] as const).map((key) => [
        key,
        a[key] == null || b[key] == null ? null : combine(a[key], b[key])
      ])
    ) as TokenCost
  }
}

export type TokenUsageSummary = {
  /** Native history replaces live observations for covered sources, avoiding replay inflation. */
  history?: 'native' | 'mixed'
  chat: TokenUsage | null
  week: TokenUsage
  month: TokenUsage
  updatedAt: number
}

export const emptyTokenUsage = (): TokenUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0
})

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0

/** Normalize providers whose reported input includes the cached subset. */
export const normalizeTokenUsage = (
  input: unknown,
  cached: unknown,
  output: unknown,
  inputIncludesCache = false
): TokenUsage => ({
  inputTokens: Math.max(0, count(input) - (inputIncludesCache ? count(cached) : 0)),
  cachedInputTokens: count(cached),
  outputTokens: count(output)
})

export const totalTokenUsage = (usage: TokenUsage): number =>
  usage.inputTokens + usage.cachedInputTokens + usage.outputTokens

export const addTokenUsage = (first: TokenUsage, second: TokenUsage): TokenUsage => ({
  inputTokens: first.inputTokens + second.inputTokens,
  cachedInputTokens: first.cachedInputTokens + second.cachedInputTokens,
  outputTokens: first.outputTokens + second.outputTokens,
  ...combineCosts(first, second, (a, b) => a + b)
})

/** Deltas of cumulative counters, with explicit fallback when the provider resets them. */
export const subtractTokenUsage = (current: TokenUsage, previous: TokenUsage): TokenUsage => ({
  inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
  cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
  outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
  ...combineCosts(current, previous, (a, b) => Math.max(0, a - b))
})

export const tokenUsageEquals = (first: TokenUsage, second: TokenUsage): boolean =>
  first.inputTokens === second.inputTokens &&
  first.cachedInputTokens === second.cachedInputTokens &&
  first.outputTokens === second.outputTokens &&
  JSON.stringify(first.cost) === JSON.stringify(second.cost)

export const formatTokenUsageCount = (value: number): string =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

export const formatTurnTokenUsage = (usage: TokenUsage): string =>
  `${formatUsageDollars(usage.cost?.total)}$`

/** Preserve small nonzero estimates instead of rounding an entire turn to $0.00. */
export const formatUsageDollars = (value: number | null | undefined): string =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en', {
        minimumFractionDigits: 2,
        maximumFractionDigits:
          value > 0 && value < 0.01 ? Math.min(12, Math.ceil(-Math.log10(value)) + 1) : 2
      }).format(value)

/** Turn metadata survives transcript unloading and paging; never read tool payloads here. */
export const applyTurnTokenUsage = (
  items: ProviderChatItem[],
  usageByTurn: ReadonlyMap<string, TokenUsage>
): ProviderChatItem[] => {
  let turnId: string | null = null
  return items.map((item) => {
    if (item.startsTurn || (item.type === 'message' && item.role === 'user')) turnId = item.id
    if (item.type !== 'working') return item
    // Native working IDs keep the anchor even in windows that omit the user message.
    const anchor = item.usageTurnId ?? turnId ?? item.id.split(':working')[0]
    const usage = usageByTurn.get(anchor)
    return usage ? { ...item, tokenUsage: usage } : item
  })
}
