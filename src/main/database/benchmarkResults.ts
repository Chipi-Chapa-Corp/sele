import type { Selectable } from 'kysely'
import {
  isProviderBenchmarkOutcome,
  type ProviderBenchmarkContender,
  type ProviderBenchmarkResult,
  type ProviderBenchmarkResultInput,
  type ProviderId
} from '../../shared/provider'
import { getDatabase, type LocalDatabase } from './sqlite'

type BenchmarkResultRow = Selectable<LocalDatabase['benchmark_result']>

// A round is identified by the primary chat and the first item of its judged turn.
const getBenchmarkResultId = (providerId: ProviderId, chatId: string, turnId: string): string =>
  JSON.stringify([providerId, chatId, turnId])

const mapContender = (
  chatId: string,
  model: string,
  reasoningEffort: string | null,
  serviceTier: string | null
): ProviderBenchmarkContender => ({ chatId, model, reasoningEffort, serviceTier })

const mapBenchmarkResultRow = (row: BenchmarkResultRow): ProviderBenchmarkResult | null => {
  if (!isProviderBenchmarkOutcome(row.outcome)) return null
  return {
    providerId: row.provider_id,
    chatId: row.chat_id,
    turnId: row.turn_id,
    outcome: row.outcome,
    primary: mapContender(
      row.primary_chat_id,
      row.primary_model,
      row.primary_reasoning_effort,
      row.primary_service_tier
    ),
    secondary: mapContender(
      row.secondary_chat_id,
      row.secondary_model,
      row.secondary_reasoning_effort,
      row.secondary_service_tier
    ),
    createdAt: row.created_at
  }
}

export const recordBenchmarkResult = async (
  providerId: ProviderId,
  result: ProviderBenchmarkResultInput
): Promise<ProviderBenchmarkResult> => {
  const db = await getDatabase()
  const id = getBenchmarkResultId(providerId, result.chatId, result.turnId)
  // A vote can replace an automatic tie. A queued tie cannot replace a vote.
  await db
    .insertInto('benchmark_result')
    .values({
      id,
      provider_id: providerId,
      chat_id: result.chatId,
      turn_id: result.turnId,
      outcome: result.outcome,
      primary_chat_id: result.primary.chatId,
      primary_model: result.primary.model,
      primary_reasoning_effort: result.primary.reasoningEffort,
      primary_service_tier: result.primary.serviceTier,
      secondary_chat_id: result.secondary.chatId,
      secondary_model: result.secondary.model,
      secondary_reasoning_effort: result.secondary.reasoningEffort,
      secondary_service_tier: result.secondary.serviceTier,
      created_at: Date.now()
    })
    .onConflict((conflict) =>
      conflict
        .column('id')
        .doUpdateSet({ outcome: result.outcome })
        .where('benchmark_result.outcome', '=', 'tie')
    )
    .execute()
  const row = await db
    .selectFrom('benchmark_result')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow()
  const saved = mapBenchmarkResultRow(row)
  if (!saved) throw new Error('Unable to read the saved benchmark result.')
  return saved
}

export const getBenchmarkResults = async (
  providerId: ProviderId,
  chatId: string
): Promise<ProviderBenchmarkResult[]> => {
  const db = await getDatabase()
  const rows = await db
    .selectFrom('benchmark_result')
    .selectAll()
    .where('provider_id', '=', providerId)
    .where('chat_id', '=', chatId)
    .orderBy('created_at')
    .execute()
  return rows.flatMap((row) => {
    const result = mapBenchmarkResultRow(row)
    return result ? [result] : []
  })
}
