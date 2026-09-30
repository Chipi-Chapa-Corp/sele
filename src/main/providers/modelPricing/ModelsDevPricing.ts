import { getDatabase } from '../../database/sqlite'
import {
  getNativeModelPricing,
  validCost,
  type ModelTokenUsage,
  type TokenPriceRates
} from './TokenPricing'

export const modelsDevPricingURL = 'https://models.dev/api.json?type=all'
const refreshEvery = 24 * 60 * 60 * 1000
const retryEvery = 60 * 60 * 1000
type Catalog = Record<'openai' | 'anthropic', Record<string, TokenPriceRates>>
type Cache = { fetchedAt: number; models: Catalog }
const object = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Only retain validated pricing for the two providers that need an external catalog. */
export const parseModelsDevPricing = (value: unknown): Catalog => {
  const root = object(value)
  const parseRates = (value: unknown): TokenPriceRates | undefined => {
    const row = object(value)
    if (!row || !validCost(row.input) || !validCost(row.output)) return undefined
    return {
      input: row.input,
      output: row.output,
      ...(validCost(row.cache_read) ? { cacheRead: row.cache_read } : {}),
      ...(validCost(row.cache_write) ? { cacheWrite: row.cache_write } : {}),
      ...(validCost(row.cache_write_1h) ? { cacheWrite1h: row.cache_write_1h } : {})
    }
  }
  const models = {} as Catalog
  for (const provider of ['openai', 'anthropic'] as const) {
    const entries = object(object(root?.[provider])?.models)
    if (!entries) throw new Error(`Models.dev has no ${provider} catalog.`)
    models[provider] = {}
    for (const [id, value] of Object.entries(entries)) {
      const cost = object(object(value)?.cost)
      const rates = parseRates(cost)
      if (!rates) continue
      const tiers = Array.isArray(cost?.tiers) ? cost.tiers : []
      rates.tiers = tiers
        .flatMap((value) => {
          const row = object(value)
          const tier = object(row?.tier)
          const rates = parseRates(row)
          return rates && tier?.type === 'context' && validCost(tier.size)
            ? [{ ...rates, contextAbove: tier.size }]
            : []
        })
        .sort((a, b) => a.contextAbove - b.contextAbove)
      // Retain compatibility with catalog snapshots predating `tiers`.
      if (!rates.tiers.length) {
        const long = parseRates(cost?.context_over_200k)
        if (long) rates.tiers = [{ ...long, contextAbove: 200_000 }]
      }
      models[provider][id] = rates
    }
    if (!Object.keys(models[provider]).length)
      throw new Error(`Models.dev has no ${provider} rates.`)
  }
  return models
}

let cached: Cache | null = null
let initialized: Promise<void> | null = null
let refreshing: Promise<void> | null = null
let nextAttempt = 0
let timer: ReturnType<typeof setInterval> | null = null
let stopped = false
let controller: AbortController | null = null

const loadSaved = (): Promise<void> => {
  initialized ??= (async () => {
    const db = await getDatabase()
    const row = await db
      .selectFrom('model_pricing_cache')
      .selectAll()
      .where('id', '=', 'models.dev')
      .executeTakeFirst()
    if (!row) return
    try {
      const saved = JSON.parse(row.payload) as Catalog
      // Cache contains our normalized schema, not a second copy of the whole catalog.
      const models = parseModelsDevPricing(
        Object.fromEntries(
          Object.entries(saved).map(([provider, models]) => [
            provider,
            {
              models: Object.fromEntries(
                Object.entries(models).map(([id, rates]) => [
                  id,
                  {
                    cost: {
                      input: rates.input,
                      output: rates.output,
                      cache_read: rates.cacheRead,
                      cache_write: rates.cacheWrite,
                      cache_write_1h: rates.cacheWrite1h,
                      tiers: rates.tiers?.map((tier) => ({
                        input: tier.input,
                        output: tier.output,
                        cache_read: tier.cacheRead,
                        cache_write: tier.cacheWrite,
                        cache_write_1h: tier.cacheWrite1h,
                        tier: { type: 'context', size: tier.contextAbove }
                      }))
                    }
                  }
                ])
              )
            }
          ])
        )
      )
      cached = { fetchedAt: row.fetched_at, models }
    } catch (error) {
      console.error('Unable to read saved model pricing.', error)
    }
  })()
  return initialized
}

export const refreshModelPricing = async (): Promise<void> => {
  await loadSaved()
  if (
    stopped ||
    refreshing ||
    Date.now() < nextAttempt ||
    (cached && Date.now() - cached.fetchedAt < refreshEvery)
  )
    return refreshing ?? undefined
  nextAttempt = Date.now() + retryEvery
  refreshing = (async () => {
    controller = new AbortController()
    const timeout = setTimeout(() => controller?.abort(), 10_000)
    try {
      const response = await fetch(modelsDevPricingURL, { signal: controller.signal })
      if (!response.ok) throw new Error(`Models.dev returned HTTP ${response.status}.`)
      const models = parseModelsDevPricing(await response.json())
      if (stopped) return
      const fetchedAt = Date.now()
      const db = await getDatabase()
      await db
        .insertInto('model_pricing_cache')
        .values({ id: 'models.dev', fetched_at: fetchedAt, payload: JSON.stringify(models) })
        .onConflict((conflict) =>
          conflict.column('id').doUpdateSet({
            fetched_at: fetchedAt,
            payload: JSON.stringify(models)
          })
        )
        .execute()
      cached = { fetchedAt, models }
    } catch (error) {
      if (!stopped) console.error('Unable to refresh model pricing; retaining saved rates.', error)
    } finally {
      clearTimeout(timeout)
      controller = null
      refreshing = null
    }
  })()
  return refreshing
}

export const resolveModelPricing = async (
  models: ModelTokenUsage[]
): Promise<ModelTokenUsage[]> => {
  models = models.map((model) => ({
    ...model,
    rates:
      model.rates ??
      (model.nativePricingKey ? getNativeModelPricing(model.nativePricingKey) : undefined)
  }))
  if (!models.some((model) => !model.rates && model.pricingProvider)) return models
  await loadSaved()
  if (!cached) await refreshModelPricing()
  else void refreshModelPricing()
  return models.map((model) => ({
    ...model,
    rates:
      model.rates ??
      (model.pricingProvider ? cached?.models[model.pricingProvider][model.modelId] : undefined)
  }))
}

export const startModelPricingRefresh = (): void => {
  stopped = false
  void refreshModelPricing().catch((error) =>
    console.error('Unable to initialize model pricing.', error)
  )
  timer ??= setInterval(() => {
    void refreshModelPricing().catch((error) =>
      console.error('Unable to refresh model pricing.', error)
    )
  }, retryEvery)
  timer.unref()
}

export const stopModelPricingRefresh = async (): Promise<void> => {
  stopped = true
  if (timer) clearInterval(timer)
  timer = null
  controller?.abort()
  await initialized
  await refreshing
}
