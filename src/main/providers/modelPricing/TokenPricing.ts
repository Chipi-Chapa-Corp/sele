import {
  addTokenUsage,
  aggregateTokenCostAssumptions,
  emptyTokenUsage,
  getTokenCost,
  subtractTokenUsage,
  totalTokenUsage,
  type TokenCost,
  type TokenCostSample,
  type TokenUsage
} from '../../../shared/tokenUsage.ts'

/** All rates normalized to USD per million tokens, independent of provider units. */
export type TokenPriceRates = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  cacheWrite1h?: number
  tiers?: (Omit<TokenPriceRates, 'tiers'> & { contextAbove: number })[]
}

export type ModelTokenUsage = {
  modelId: string
  pricingProvider?: 'openai' | 'anthropic'
  usage: TokenUsage
  cacheWriteTokens?: number
  cacheWrite1hTokens?: number
  contextTokens?: number
  rates?: TokenPriceRates
  nativePricingKey?: string
  /** Native USD total is authoritative for the estimate; rates apportion its categories. */
  totalUSD?: number
}

const nativeRates = new Map<string, TokenPriceRates>()
export const setNativeModelPricing = (key: string, rates: TokenPriceRates): void => {
  nativeRates.set(key, rates)
}
export const getNativeModelPricing = (key: string): TokenPriceRates | undefined =>
  nativeRates.get(key)

export const validCost = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export const estimateModelCost = (model: ModelTokenUsage): TokenCost => {
  const usage = model.usage
  let rates = model.rates
  for (const tier of rates?.tiers ?? []) {
    if ((model.contextTokens ?? 0) > tier.contextAbove) rates = tier
  }
  const write = Math.min(model.cacheWriteTokens ?? 0, usage.inputTokens)
  const write1h = Math.min(model.cacheWrite1hTokens ?? 0, write)
  const priced = (tokens: number, rate: number | undefined): number | null =>
    tokens === 0 ? 0 : validCost(rate) ? (tokens * rate) / 1_000_000 : null
  const sum = (...values: (number | null)[]): number | null =>
    values.some((value) => value == null)
      ? null
      : values.reduce<number>((total, value) => total + value!, 0)
  let input = sum(
    priced(usage.inputTokens - write, rates?.input),
    priced(write - write1h, rates?.cacheWrite),
    priced(write1h, rates?.cacheWrite1h ?? rates?.cacheWrite)
  )
  let cachedInput = priced(usage.cachedInputTokens, rates?.cacheRead)
  let output = priced(usage.outputTokens, rates?.output)
  const estimated = sum(input, cachedInput, output)
  const total = validCost(model.totalUSD) ? model.totalUSD : estimated
  if (validCost(model.totalUSD)) {
    if (total === 0) input = cachedInput = output = 0
    else if (estimated != null && estimated > 0) {
      const factor = total! / estimated
      input = input! * factor
      cachedInput = cachedInput! * factor
      output = output! * factor
    }
  }
  return { input, cachedInput, output, total }
}

/** Legacy records retain their actual token split; only the absent model is assumed. */
export const applyFallbackModelPricing = (
  usage: TokenUsage,
  model: ModelTokenUsage | undefined
): TokenUsage => {
  const known = getTokenCost(usage)
  if (!model || Object.values(known).every((cost) => cost != null)) return usage
  const estimated = estimateModelCost({
    ...model,
    usage,
    contextTokens: undefined,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    totalUSD: known.total ?? undefined
  })
  if (!Object.values(estimated).some((cost) => cost != null)) return usage
  return {
    ...usage,
    costUsesFallback: true,
    cost: {
      input: known.input ?? estimated.input,
      cachedInput: known.cachedInput ?? estimated.cachedInput,
      output: known.output ?? estimated.output,
      total: known.total ?? estimated.total
    }
  }
}

/** Aggregate-only statistics use a fixed category split, independent of the observed split. */
export const estimateAggregateTokenRate = (models: ModelTokenUsage[]): TokenCostSample | null => {
  let tokens = 0
  let weight = 0
  let weightedRate = 0
  for (const model of models) {
    const rate = estimateModelCost({
      ...model,
      usage: aggregateTokenCostAssumptions,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      totalUSD: undefined
    }).total
    if (rate == null) continue
    const modelTokens = totalTokenUsage(model.usage)
    const modelWeight = modelTokens || 1
    tokens += modelTokens
    weight += modelWeight
    weightedRate += rate * modelWeight
  }
  return weight > 0 ? { tokens, usdPerMillionTokens: weightedRate / weight } : null
}

/** Difference each model separately so a model switch never reprices earlier calls. */
export const differenceModelUsage = (
  current: ModelTokenUsage[],
  previous: ModelTokenUsage[] | undefined,
  initialUsage?: TokenUsage
): ModelTokenUsage[] =>
  current.map((model) => {
    const before = previous?.find((candidate) => candidate.modelId === model.modelId)
    const reset =
      before &&
      (model.usage.inputTokens < before.usage.inputTokens ||
        model.usage.cachedInputTokens < before.usage.cachedInputTokens ||
        model.usage.outputTokens < before.usage.outputTokens)
    if (!before || reset) {
      return !previous && initialUsage && current.length === 1
        ? { ...model, usage: initialUsage }
        : model
    }
    return {
      ...model,
      usage: subtractTokenUsage(model.usage, before.usage),
      cacheWriteTokens: Math.max(0, (model.cacheWriteTokens ?? 0) - (before.cacheWriteTokens ?? 0)),
      cacheWrite1hTokens: Math.max(
        0,
        (model.cacheWrite1hTokens ?? 0) - (before.cacheWrite1hTokens ?? 0)
      ),
      totalUSD:
        validCost(model.totalUSD) && validCost(before.totalUSD)
          ? Math.max(0, model.totalUSD - before.totalUSD)
          : model.totalUSD
    }
  })

export const priceModelUsage = (models: ModelTokenUsage[]): TokenUsage =>
  models.reduce(
    (total, model) => addTokenUsage(total, { ...model.usage, cost: estimateModelCost(model) }),
    emptyTokenUsage()
  )

/** Copilot returns credits per batch; one AI credit is USD 0.01. */
export const copilotPriceRates = (
  prices:
    | {
        batchSize?: number
        inputPrice?: number
        outputPrice?: number
        cachePrice?: number
        cacheReadPrice?: number
        cacheWritePrice?: number
        cacheWrite1hPrice?: number
        longContext?: {
          inputPrice?: number
          outputPrice?: number
          cachePrice?: number
          cacheReadPrice?: number
          cacheWritePrice?: number
          cacheWrite1hPrice?: number
        }
        maxPromptTokens?: number
      }
    | undefined
): TokenPriceRates | undefined => {
  if (!prices || !validCost(prices.batchSize) || prices.batchSize <= 0) return undefined
  const scale = 10_000 / prices.batchSize
  const convert = (value: number | undefined): number | undefined =>
    validCost(value) ? value * scale : undefined
  const rates = (row: NonNullable<typeof prices.longContext>): TokenPriceRates | undefined => {
    const input = convert(row.inputPrice)
    const output = convert(row.outputPrice)
    if (input == null || output == null) return undefined
    return {
      input,
      output,
      cacheRead: convert(row.cacheReadPrice ?? row.cachePrice),
      cacheWrite: convert(row.cacheWritePrice),
      cacheWrite1h: convert(row.cacheWrite1hPrice)
    }
  }
  const base = rates(prices)
  if (base && prices.longContext && prices.maxPromptTokens) {
    const long = rates(prices.longContext)
    if (long) base.tiers = [{ ...long, contextAbove: prices.maxPromptTokens }]
  }
  return base
}
