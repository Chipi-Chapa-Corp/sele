import type { ProviderChat, ProviderChatTurnOutcome, ProviderId } from '../../shared/provider'
import { getDatabase } from './sqlite'

export const setChatTurnOutcome = async (
  providerId: ProviderId,
  chatId: string,
  outcome: ProviderChatTurnOutcome | null
): Promise<void> => {
  const db = await getDatabase()
  const values = { id: `${providerId}:${chatId}`, outcome, observed_at: Date.now() }
  await db
    .insertInto('chat_turn_outcome')
    .values(values)
    .onConflict((conflict) => {
      const update = conflict.column('id').doUpdateSet(values)
      return outcome === null ? update.where('chat_turn_outcome.outcome', 'is not', null) : update
    })
    .execute()
}

export const getChatTurnOutcomes = async (
  chats: ProviderChat[]
): Promise<Map<string, ProviderChatTurnOutcome | null>> => {
  const outcomes = new Map<string, ProviderChatTurnOutcome | null>()
  if (!chats.length) return outcomes
  const db = await getDatabase()
  const updatedAtByKey = new Map(
    chats.map((chat) => [`${chat.providerId}:${chat.id}`, chat.updatedAt])
  )
  const ids = [...updatedAtByKey.keys()]
  for (let index = 0; index < ids.length; index += 200) {
    const rows = await db
      .selectFrom('chat_turn_outcome')
      .selectAll()
      .where('id', 'in', ids.slice(index, index + 200))
      .execute()
    for (const row of rows) {
      // Native history may advance while Sele is closed. An older observation cannot describe it.
      if (row.observed_at >= updatedAtByKey.get(row.id)!) outcomes.set(row.id, row.outcome)
    }
  }
  return outcomes
}
