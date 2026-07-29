import type { ProviderReview, ProviderReviewComment } from '../../shared/provider'
import { getDatabase } from './sqlite'

export type StoredMessageReview = Omit<ProviderReview, 'prompt'> & {
  chatId: string
  prompt: string
  serializedContent: string
  createdAt: number
}

const parseComments = (value: string): ProviderReviewComment[] => {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((candidate, index) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const { id, path, comment, line, endLine, side } = candidate as {
        id?: unknown
        path?: unknown
        comment?: unknown
        line?: unknown
        endLine?: unknown
        side?: unknown
      }
      if (typeof path !== 'string' || typeof comment !== 'string') return []

      const parsedLine = typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : 1
      const parsedEndLine =
        typeof endLine === 'number' && Number.isInteger(endLine) && endLine >= parsedLine
          ? endLine
          : parsedLine

      return [
        {
          id: typeof id === 'string' && id ? id : `legacy:${index}`,
          path,
          comment,
          line: parsedLine,
          endLine: parsedEndLine,
          side: side === 'old' ? side : ('new' as const)
        }
      ]
    })
  } catch {
    return []
  }
}

export const getMessageReviews = async (chatId: string): Promise<StoredMessageReview[]> => {
  const db = await getDatabase()
  const rows = await db
    .selectFrom('message_reviews')
    .select(['id', 'chat_id', 'prompt', 'serialized_content', 'comments_json', 'created_at'])
    .where('chat_id', '=', chatId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .execute()

  return rows.map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    prompt: row.prompt,
    serializedContent: row.serialized_content,
    comments: parseComments(row.comments_json),
    createdAt: row.created_at
  }))
}

export const setMessageReview = async (
  chatId: string,
  serializedContent: string,
  prompt: string,
  review: ProviderReview
): Promise<void> => {
  const db = await getDatabase()

  await db
    .insertInto('message_reviews')
    .values({
      id: review.id,
      chat_id: chatId,
      prompt,
      serialized_content: serializedContent,
      comments_json: JSON.stringify(review.comments),
      created_at: Date.now()
    })
    .onConflict((conflict) =>
      conflict.column('id').doUpdateSet({
        chat_id: chatId,
        prompt,
        serialized_content: serializedContent,
        comments_json: JSON.stringify(review.comments)
      })
    )
    .execute()
}

export const deleteMessageReview = async (id: string): Promise<void> => {
  const db = await getDatabase()
  await db.deleteFrom('message_reviews').where('id', '=', id).execute()
}
