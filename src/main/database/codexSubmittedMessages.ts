import type { CodexUserInput } from '../providers/codex/CodexItemRenderers'
import { getDatabase } from './sqlite'

export type CodexSubmittedMessage = {
  chatId: string
  clientMessageId: string
  turnId: string | null
  input: CodexUserInput[]
  createdAt: number
}

const mapSubmittedMessage = (row: {
  chat_id: string
  client_message_id: string
  turn_id: string | null
  input_json: string
  created_at: number
}): CodexSubmittedMessage => ({
  chatId: row.chat_id,
  clientMessageId: row.client_message_id,
  turnId: row.turn_id,
  input: JSON.parse(row.input_json) as CodexUserInput[],
  createdAt: row.created_at
})

export const saveCodexSubmittedMessage = async (
  chatId: string,
  clientMessageId: string,
  input: CodexUserInput[]
): Promise<void> => {
  const db = await getDatabase()
  await db
    .insertInto('codex_submitted_messages')
    .values({
      chat_id: chatId,
      client_message_id: clientMessageId,
      turn_id: null,
      input_json: JSON.stringify(input),
      created_at: Date.now()
    })
    .onConflict((conflict) =>
      conflict.column('client_message_id').doUpdateSet({
        chat_id: chatId,
        turn_id: null,
        input_json: JSON.stringify(input)
      })
    )
    .execute()
}

export const bindCodexSubmittedMessageToTurn = async (
  clientMessageId: string,
  turnId: string
): Promise<void> => {
  const db = await getDatabase()
  const result = await db
    .updateTable('codex_submitted_messages')
    .set({ turn_id: turnId })
    .where('client_message_id', '=', clientMessageId)
    .executeTakeFirst()

  if (Number(result.numUpdatedRows) !== 1) {
    throw new Error('Submitted Codex message was not recorded before its turn started')
  }
}

export const getCodexSubmittedMessages = async (
  chatId: string
): Promise<CodexSubmittedMessage[]> => {
  const db = await getDatabase()
  const rows = await db
    .selectFrom('codex_submitted_messages')
    .selectAll()
    .where('chat_id', '=', chatId)
    .orderBy('created_at', 'asc')
    .execute()

  return rows.map(mapSubmittedMessage)
}

export const deleteCodexSubmittedMessages = async (clientMessageIds: string[]): Promise<void> => {
  if (clientMessageIds.length === 0) return
  const db = await getDatabase()
  await db
    .deleteFrom('codex_submitted_messages')
    .where('client_message_id', 'in', clientMessageIds)
    .execute()
}

export const deleteCodexSubmittedMessagesForTurns = async (
  chatId: string,
  turnIds: string[]
): Promise<void> => {
  if (turnIds.length === 0) return
  const db = await getDatabase()
  await db
    .deleteFrom('codex_submitted_messages')
    .where('chat_id', '=', chatId)
    .where('turn_id', 'in', turnIds)
    .execute()
}
