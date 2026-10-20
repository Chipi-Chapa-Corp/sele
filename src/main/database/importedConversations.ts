import type { ImportedConversation, ImportStore } from '../providers/ImportedConversations'
import { ChatArchiveWorker } from '../providers/ChatArchiveWorker'
import { getDatabase } from './sqlite'

const serialization = new ChatArchiveWorker()

export const importedConversationStore: ImportStore = {
  list: async () => {
    const rows = await (await getDatabase())
      .selectFrom('imported_conversation')
      .select('summary')
      .execute()
    return rows.map((row) => JSON.parse(row.summary) as ImportedConversation)
  },
  get: async (id) => {
    const row = await (await getDatabase())
      .selectFrom('imported_conversation')
      .select('payload')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
    return serialization.parse<ImportedConversation>(row.payload)
  },
  save: async (record) => {
    const payload = await serialization.stringify(record)
    const summary = JSON.stringify({ ...record, archive: undefined, baseline: undefined })
    await (await getDatabase())
      .insertInto('imported_conversation')
      .values({ id: `${record.providerId}:${record.chatId}`, payload, summary })
      .onConflict((conflict) => conflict.column('id').doUpdateSet({ payload, summary }))
      .execute()
  }
}
