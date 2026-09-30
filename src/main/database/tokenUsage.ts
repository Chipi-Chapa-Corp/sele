import { sql } from 'kysely'
import type { ProviderAccountUsageSummary, ProviderId } from '../../shared/provider'
import type { TokenUsage, TokenUsageSummary } from '../../shared/tokenUsage'
import {
  addTokenUsage,
  emptyTokenUsage,
  extrapolateTokenCost,
  totalTokenUsage
} from '../../shared/tokenUsage'
import { getTokenUsageIncrement, type TokenUsageObservation } from '../providers/TokenUsageReporter'
import {
  applyFallbackModelPricing,
  differenceModelUsage,
  estimateAggregateTokenRate,
  priceModelUsage,
  type ModelTokenUsage
} from '../providers/modelPricing/TokenPricing'
import { resolveModelPricing } from '../providers/modelPricing/ModelsDevPricing'
import { getDatabase } from './sqlite'
import type { HistoricalTokenUsageSnapshot } from '../providers/ProviderAdapter'

let pendingWrites: Promise<void> = Promise.resolve()
const key = (...parts: (string | null)[]): string => JSON.stringify(parts)
const columns = (usage: TokenUsage) => ({
  input_tokens: usage.inputTokens,
  cached_input_tokens: usage.cachedInputTokens,
  output_tokens: usage.outputTokens
})
const costColumns = (usage: TokenUsage) => ({
  input_usd: usage.cost?.input ?? null,
  cached_input_usd: usage.cost?.cachedInput ?? null,
  output_usd: usage.cost?.output ?? null,
  total_usd: usage.cost?.total ?? null
})
const fromRow = (row: {
  input_tokens: number | null
  cached_input_tokens: number | null
  output_tokens: number | null
  input_usd?: number | null
  cached_input_usd?: number | null
  output_usd?: number | null
  total_usd?: number | null
}): TokenUsage => ({
  inputTokens: row.input_tokens ?? 0,
  cachedInputTokens: row.cached_input_tokens ?? 0,
  outputTokens: row.output_tokens ?? 0,
  ...(row.total_usd != null ||
  row.input_usd != null ||
  row.cached_input_usd != null ||
  row.output_usd != null
    ? {
        cost: {
          input: row.input_usd ?? null,
          cachedInput: row.cached_input_usd ?? null,
          output: row.output_usd ?? null,
          total: row.total_usd ?? null
        }
      }
    : {})
})

/** Serialize observations before asynchronous UI snapshots can coalesce or reorder them. */
export const recordTokenUsage = (
  providerId: ProviderId,
  observation: TokenUsageObservation
): void => {
  pendingWrites = pendingWrites
    .then(async () => {
      // Catalog I/O runs outside the ledger transaction, including on a cold start.
      const resolvedModels = observation.models
        ? await resolveModelPricing(observation.models)
        : undefined
      const db = await getDatabase()
      await db.transaction().execute(async (trx) => {
        if (observation.parentChatId && observation.parentChatId !== observation.chatId) {
          const lineage = {
            id: key(providerId, observation.sourceKey, observation.chatId),
            provider_id: providerId,
            source_key: observation.sourceKey,
            chat_id: observation.chatId,
            parent_chat_id: observation.parentChatId,
            parent_turn_id: observation.parentTurnId ?? null
          }
          await trx
            .insertInto('token_usage_chat_parent')
            .values(lineage)
            .onConflict((conflict) =>
              conflict.column('id').doUpdateSet({
                parent_chat_id: lineage.parent_chat_id,
                parent_turn_id: sql`coalesce(${lineage.parent_turn_id}, parent_turn_id)`
              })
            )
            .execute()
        }
        const streamKey = key(
          providerId,
          observation.sourceKey,
          observation.chatId,
          observation.recordId
        )
        let usage = observation.usage
        let models = resolvedModels
        if (observation.cumulative) {
          const previous = await trx
            .selectFrom('token_usage_checkpoint')
            .selectAll()
            .where('id', '=', streamKey)
            .executeTakeFirst()
          const increment = getTokenUsageIncrement(
            observation,
            previous ? { usage: fromRow(previous), timestamp: previous.updated_at } : undefined
          )
          if (!increment) return
          usage = increment
          if (models)
            models = differenceModelUsage(
              models,
              previous?.models_json
                ? (JSON.parse(previous.models_json) as ModelTokenUsage[])
                : undefined,
              !previous ? observation.initialUsage : undefined
            )
          // Codex counters are thread-wide even when the current turn uses a different model.
          if (providerId === 'codex' && models?.length === 1)
            models = [{ ...models[0], usage: increment }]
          if (models) usage = { ...usage, cost: priceModelUsage(models).cost }
          await trx
            .insertInto('token_usage_checkpoint')
            .values({
              id: streamKey,
              ...columns(observation.usage),
              updated_at: observation.timestamp,
              models_json: resolvedModels ? JSON.stringify(resolvedModels) : null
            })
            .onConflict((conflict) =>
              conflict.column('id').doUpdateSet({
                ...columns(observation.usage),
                updated_at: observation.timestamp,
                models_json: resolvedModels ? JSON.stringify(resolvedModels) : null
              })
            )
            .execute()
          if (totalTokenUsage(usage) === 0 && !(usage.cost?.total && usage.cost.total > 0)) return
        }
        if (models) usage = { ...usage, cost: priceModelUsage(models).cost }
        if (totalTokenUsage(usage) === 0 && !(usage.cost?.total && usage.cost.total > 0)) return
        if (observation.replaceProvisionalGroup) {
          await trx
            .deleteFrom('token_usage')
            .where('provider_id', '=', providerId)
            .where('source_key', '=', observation.sourceKey)
            .where('chat_id', '=', observation.chatId)
            .where('provisional_group', '=', observation.replaceProvisionalGroup)
            .where('provisional_complete', '=', 1)
            .execute()
        }
        const id = observation.cumulative ? key(streamKey, observation.turnId) : streamKey
        const values = columns(usage)
        const costs = costColumns(usage)
        const previousRecord = await trx
          .selectFrom('token_usage')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()
        const storedModels = models
          ? observation.cumulative && previousRecord?.models_json
            ? [...(JSON.parse(previousRecord.models_json) as ModelTokenUsage[]), ...models]
            : models
          : undefined
        const pricedAt =
          usage.cost && Object.values(usage.cost).every((value) => value != null)
            ? Date.now()
            : null
        await trx
          .insertInto('token_usage')
          .values({
            id,
            provider_id: providerId,
            source_key: observation.sourceKey,
            chat_id: observation.chatId,
            turn_id: observation.turnId,
            recorded_at: observation.timestamp,
            provisional_group: observation.provisionalGroup ?? null,
            provisional_complete: observation.provisionalComplete ? 1 : 0,
            ...costs,
            models_json: storedModels ? JSON.stringify(storedModels) : null,
            priced_at: pricedAt,
            ...values
          })
          .onConflict((conflict) =>
            conflict.column('id').doUpdateSet(
              observation.cumulative
                ? {
                    input_tokens: sql`input_tokens + ${values.input_tokens}`,
                    cached_input_tokens: sql`cached_input_tokens + ${values.cached_input_tokens}`,
                    output_tokens: sql`output_tokens + ${values.output_tokens}`,
                    input_usd: sql`input_usd + ${costs.input_usd}`,
                    cached_input_usd: sql`cached_input_usd + ${costs.cached_input_usd}`,
                    output_usd: sql`output_usd + ${costs.output_usd}`,
                    total_usd: sql`total_usd + ${costs.total_usd}`,
                    models_json: storedModels ? JSON.stringify(storedModels) : null,
                    priced_at: previousRecord?.priced_at && pricedAt ? pricedAt : null
                  }
                : {
                    // Native request snapshots can be repeated while streaming or reloading history.
                    input_tokens: sql`max(input_tokens, ${values.input_tokens})`,
                    cached_input_tokens: sql`max(cached_input_tokens, ${values.cached_input_tokens})`,
                    output_tokens: sql`max(output_tokens, ${values.output_tokens})`,
                    // Do not replace a fuller native estimate with a partial snapshot.
                    input_usd: sql`case when ${costs.input_usd} is null then input_usd else max(coalesce(input_usd, 0), ${costs.input_usd}) end`,
                    cached_input_usd: sql`case when ${costs.cached_input_usd} is null then cached_input_usd else max(coalesce(cached_input_usd, 0), ${costs.cached_input_usd}) end`,
                    output_usd: sql`case when ${costs.output_usd} is null then output_usd else max(coalesce(output_usd, 0), ${costs.output_usd}) end`,
                    total_usd: sql`case when ${costs.total_usd} is null then total_usd else max(coalesce(total_usd, 0), ${costs.total_usd}) end`,
                    models_json: storedModels
                      ? JSON.stringify(storedModels)
                      : (previousRecord?.models_json ?? null),
                    priced_at: pricedAt,
                    turn_id: observation.turnId,
                    provisional_complete: sql`max(provisional_complete, ${observation.provisionalComplete ? 1 : 0})`
                  }
            )
          )
          .execute()
      })
    })
    .catch((error: unknown) => console.error('Unable to persist token usage.', error))
}

export const flushTokenUsage = (): Promise<void> => pendingWrites

let repricing: Promise<void> | null = null
/** Fill estimates that were recorded before pricing arrived; never change an existing quote. */
const fillMissingPrices = (): Promise<void> => {
  repricing ??= (async () => {
    await flushTokenUsage()
    const db = await getDatabase()
    const rows = await db
      .selectFrom('token_usage')
      .selectAll()
      .where('priced_at', 'is', null)
      .where('models_json', 'is not', null)
      .limit(500)
      .execute()
    for (const row of rows) {
      const models = await resolveModelPricing(JSON.parse(row.models_json!) as ModelTokenUsage[])
      const usage = priceModelUsage(models)
      if (!usage.cost || !Object.values(usage.cost).some((value) => value != null)) continue
      await db
        .updateTable('token_usage')
        .set({
          ...costColumns(usage),
          models_json: JSON.stringify(models),
          priced_at: Object.values(usage.cost).every((value) => value != null) ? Date.now() : null
        })
        .where('id', '=', row.id)
        .where('models_json', '=', row.models_json)
        .where('priced_at', 'is', null)
        .execute()
    }
  })().finally(() => {
    repricing = null
  })
  return repricing
}

type UsageRow = Parameters<typeof fromRow>[0] & {
  provider_id: ProviderId
  source_key: string
  chat_id: string
  models_json: string | null
}

/** Fallback quotes stay out of the ledger so a guessed model never becomes historical fact. */
const getUsagePriceFallbacks = async (providerId?: ProviderId, sourceKey?: string) => {
  const db = await getDatabase()
  let query = db
    .selectFrom('token_usage')
    .select([
      'provider_id',
      'source_key',
      'chat_id',
      'models_json',
      'recorded_at',
      sql<number>`row_number() over (partition by provider_id, source_key, chat_id order by recorded_at desc)`.as(
        'rank'
      )
    ])
    .where('models_json', 'is not', null)
    .where(
      sql<boolean>`exists (select 1 from json_each(models_json) where json_extract(value, '$.rates.input') is not null and json_extract(value, '$.rates.output') is not null)`
    )
  if (providerId) query = query.where('provider_id', '=', providerId)
  if (sourceKey) query = query.where('source_key', '=', sourceKey)
  const rows = await db
    .selectFrom(query.as('quotes'))
    .selectAll()
    .where('rank', '=', 1)
    .orderBy('recorded_at', 'desc')
    .execute()
  const byChat = new Map<string, ModelTokenUsage>()
  const bySource = new Map<string, ModelTokenUsage>()
  for (const row of rows) {
    const chatKey = key(row.provider_id, row.source_key, row.chat_id)
    if (byChat.has(chatKey)) continue
    const model = (JSON.parse(row.models_json!) as ModelTokenUsage[]).find((model) => model.rates)
    if (!model) continue
    byChat.set(chatKey, model)
    const sourceKey = key(row.provider_id, row.source_key)
    if (!bySource.has(sourceKey)) bySource.set(sourceKey, model)
  }
  return (row: UsageRow): TokenUsage => {
    const usage = fromRow(row)
    if (row.models_json) return usage
    return applyFallbackModelPricing(
      usage,
      byChat.get(key(row.provider_id, row.source_key, row.chat_id)) ??
        bySource.get(key(row.provider_id, row.source_key))
    )
  }
}

export const getChatTokenUsage = async (
  providerId: ProviderId,
  sourceKey: string,
  chatId: string
): Promise<{ total: TokenUsage | null; byTurn: Map<string, TokenUsage> }> => {
  await flushTokenUsage()
  await fillMissingPrices()
  const db = await getDatabase()
  const priceRow = await getUsagePriceFallbacks(providerId, sourceKey)
  const { rows } = await sql<
    UsageRow & { root_turn_id: string | null; turn_id: string | null }
  >`with recursive chat_tree(chat_id, root_turn_id) as (
    select ${chatId}, null
    union
    select parent.chat_id, coalesce(tree.root_turn_id, parent.parent_turn_id)
    from token_usage_chat_parent parent join chat_tree tree on parent.parent_chat_id = tree.chat_id
    where parent.provider_id = ${providerId} and parent.source_key = ${sourceKey}
  ) select usage.provider_id, usage.source_key, usage.chat_id,
    usage.input_tokens, usage.cached_input_tokens, usage.output_tokens,
    usage.input_usd, usage.cached_input_usd, usage.output_usd, usage.total_usd,
    case when usage.models_json is null then null else 'known' end as models_json,
    coalesce(tree.root_turn_id, usage.turn_id) as root_turn_id
    from token_usage usage join chat_tree tree on usage.chat_id = tree.chat_id
    where usage.provider_id = ${providerId} and usage.source_key = ${sourceKey}`.execute(db)
  const byTurn = new Map<string, TokenUsage>()
  let total: TokenUsage | null = null
  for (const row of rows) {
    const usage = priceRow(row)
    total = addTokenUsage(total ?? emptyTokenUsage(), usage)
    if (row.root_turn_id)
      byTurn.set(
        row.root_turn_id,
        addTokenUsage(byTurn.get(row.root_turn_id) ?? emptyTokenUsage(), usage)
      )
  }
  return {
    total,
    byTurn
  }
}

/** Rolling windows include all sources and chats for the selected provider. */
export const getTokenUsageSummary = async (
  providerId: ProviderId,
  sourceKey: string,
  chatId: string | null,
  now = Date.now(),
  nativeSources: ReadonlyMap<string, HistoricalTokenUsageSnapshot> = new Map()
): Promise<TokenUsageSummary> => {
  await flushTokenUsage()
  await fillMissingPrices()
  const db = await getDatabase()
  const priceRow = await getUsagePriceFallbacks(providerId)
  const [chat, rows] = await Promise.all([
    nativeSources.has(sourceKey)
      ? nativeSources.get(sourceKey)!.chat
      : chatId
        ? getChatTokenUsage(providerId, sourceKey, chatId).then((usage) => usage.total)
        : null,
    db
      .selectFrom('token_usage')
      .select([
        'provider_id',
        'source_key',
        'chat_id',
        'recorded_at',
        'input_tokens',
        'cached_input_tokens',
        'output_tokens',
        'input_usd',
        'cached_input_usd',
        'output_usd',
        'total_usd',
        sql<string | null>`case when models_json is null then null else 'known' end`.as(
          'models_json'
        )
      ])
      .where('provider_id', '=', providerId)
      .where('recorded_at', '>=', now - 30 * 86_400_000)
      .where('recorded_at', '<=', now)
      .$if(nativeSources.size > 0, (query) =>
        query.where('source_key', 'not in', [...nativeSources.keys()])
      )
      .execute()
  ])
  let week = emptyTokenUsage()
  let month = emptyTokenUsage()
  const databases = new Map<string, HistoricalTokenUsageSnapshot>()
  for (const [key, native] of nativeSources) {
    const identity = native.sourceIdentity ?? key
    const previous = databases.get(identity)
    if (!previous || native.updatedAt > previous.updatedAt) databases.set(identity, native)
  }
  for (const native of databases.values()) {
    week = addTokenUsage(week, native.week)
    month = addTokenUsage(month, native.month)
  }
  for (const row of rows) {
    const usage = priceRow(row)
    month = addTokenUsage(month, usage)
    if (row.recorded_at >= now - 7 * 86_400_000) week = addTokenUsage(week, usage)
  }
  return {
    chat,
    week,
    month,
    updatedAt:
      nativeSources.size > 0
        ? Math.min(...[...nativeSources.values()].map((source) => source.updatedAt))
        : now,
    ...(nativeSources.size > 0
      ? {
          history:
            rows.length > 0 || !nativeSources.has(sourceKey)
              ? ('mixed' as const)
              : ('native' as const)
        }
      : {})
  }
}

/** Estimate native aggregate totals without requiring a historical category breakdown. */
export const getAccountUsageCosts = async (
  providerId: ProviderId,
  sourceKey: string,
  summary: ProviderAccountUsageSummary,
  fallbackModel?: () => Promise<ModelTokenUsage | null>
): Promise<
  Pick<
    ProviderAccountUsageSummary,
    'lifetimeCostUSD' | 'peakDailyCostUSD' | 'lifetimeCostSample' | 'peakDailyCostSample'
  >
> => {
  await flushTokenUsage()
  await fillMissingPrices()
  const db = await getDatabase()
  const rows = await db
    .selectFrom('token_usage')
    .select('models_json')
    .where('provider_id', '=', providerId)
    .where('source_key', '=', sourceKey)
    .where('models_json', 'is not', null)
    .execute()
  const models = rows.flatMap((row) => JSON.parse(row.models_json!) as ModelTokenUsage[])
  let sample = estimateAggregateTokenRate(models)
  if (!sample && fallbackModel) {
    const model = await fallbackModel()
    if (model) sample = estimateAggregateTokenRate(await resolveModelPricing([model]))
  }
  const lifetime = extrapolateTokenCost(summary.lifetimeTokens, sample)
  const peak = extrapolateTokenCost(summary.peakDailyTokens, sample)
  return {
    lifetimeCostUSD: lifetime.costUSD,
    lifetimeCostSample: lifetime.sample,
    peakDailyCostUSD: peak.costUSD,
    peakDailyCostSample: peak.sample
  }
}
