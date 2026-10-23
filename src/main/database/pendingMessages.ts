import type { ProviderId } from '../../shared/provider'
import type {
  PendingMessageBackend,
  PendingMessageRow
} from '../providers/PersistentPendingMessages'
import { getDatabase } from './sqlite'

/** SQLite storage for messages that were queued or steered but not yet taken by a provider. */
export const sqlitePendingMessageBackend: PendingMessageBackend = {
  replace: async (providerId: ProviderId, chatId: string, rows: PendingMessageRow[]) => {
    const db = await getDatabase()
    await db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom('pending_messages')
        .where('provider_id', '=', providerId)
        .where('chat_id', '=', chatId)
        .execute()
      if (rows.length === 0) return
      await transaction
        .insertInto('pending_messages')
        .values(
          rows.map((row, position) => ({
            provider_id: providerId,
            chat_id: chatId,
            message_id: row.id,
            position,
            kind: row.kind,
            submitted: row.submitted ? 1 : 0,
            payload: row.payload,
            created_at: row.createdAt
          }))
        )
        .execute()
    })
  },
  read: async (providerId: ProviderId, chatId: string) => {
    const db = await getDatabase()
    const rows = await db
      .selectFrom('pending_messages')
      .selectAll()
      .where('provider_id', '=', providerId)
      .where('chat_id', '=', chatId)
      .orderBy('position', 'asc')
      .execute()
    return rows.map((row) => ({
      id: row.message_id,
      kind: row.kind === 'steering' ? 'steering' : 'queued',
      submitted: row.submitted === 1,
      payload: row.payload,
      createdAt: row.created_at
    }))
  }
}
