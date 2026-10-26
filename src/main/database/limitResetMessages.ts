import { sql } from 'kysely'
import type { LimitResetBackend, LimitResetEntry } from '../providers/LimitResetQueue'
import { getDatabase } from './sqlite'

export const limitResetMessageBackend: LimitResetBackend = {
  list: async () => {
    const db = await getDatabase()
    const rows = await db
      .selectFrom('limit_reset_messages')
      .selectAll()
      .orderBy('created_at', 'asc')
      .orderBy(sql`rowid`, 'asc')
      .execute()
    return rows.map((row) => JSON.parse(row.payload) as LimitResetEntry)
  },
  put: async (entry) => {
    const db = await getDatabase()
    await db
      .insertInto('limit_reset_messages')
      .values({ id: entry.id, created_at: entry.createdAt, payload: JSON.stringify(entry) })
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet({ payload: JSON.stringify(entry) })
      )
      .execute()
  },
  remove: async (id) => {
    const db = await getDatabase()
    await db.deleteFrom('limit_reset_messages').where('id', '=', id).execute()
  }
}
