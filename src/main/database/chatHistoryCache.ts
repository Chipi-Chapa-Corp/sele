import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { LocalDatabase } from './sqlite'
import type { ProviderChatDetail, ProviderChatItem } from '../../shared/provider'
import { assertUniqueProviderChatItemIds, getProviderChatTurns } from '../../shared/chatTurns.ts'

export type CachedChatHistory = Pick<
  ProviderChatDetail,
  'items' | 'itemsStartTurnIndex' | 'turnCount' | 'turnPagination'
>
export type ChatHistoryStore = {
  read(key: string, fingerprint: string): Promise<CachedChatHistory | null>
  save(
    key: string,
    fingerprint: string,
    history: CachedChatHistory,
    current: () => boolean
  ): Promise<boolean>
}

const formatVersion = 1
const maxPageBytes = 2_000_000
const maxCacheBytes = 64_000_000
const maxPages = 100
const maxAgeMs = 7 * 24 * 60 * 60 * 1000

/** Only bounded prepared pages enter this store, never raw provider transcripts. */
export class SqliteChatHistoryCache implements ChatHistoryStore {
  private database: () => Promise<Kysely<LocalDatabase>>
  private now: () => number
  constructor(database: () => Promise<Kysely<LocalDatabase>>, now = Date.now) {
    this.database = database
    this.now = now
  }

  async read(key: string, fingerprint: string): Promise<CachedChatHistory | null> {
    const db = await this.database()
    return db.transaction().execute(async (db) => {
      const page = await db
        .selectFrom('chat_history_page')
        .selectAll()
        .where('cache_key', '=', key)
        .executeTakeFirst()
      if (!page) return null
      if (
        page.fingerprint !== fingerprint ||
        page.format_version !== formatVersion ||
        page.saved_at < this.now() - maxAgeMs ||
        page.byte_size > maxPageBytes
      )
        return null
      const rows = await db
        .selectFrom('chat_history_turn')
        .select(['payload', 'turn_id', 'position', 'content_hash'])
        .where('cache_key', '=', key)
        .orderBy('position')
        .execute()
      try {
        const { turnIds, ...coordinates } = JSON.parse(page.coordinates) as Omit<
          CachedChatHistory,
          'items'
        > & { turnIds: string[] }
        if (
          !Array.isArray(turnIds) ||
          turnIds.length !== rows.length ||
          (coordinates.itemsStartTurnIndex !== undefined &&
            (!Number.isSafeInteger(coordinates.itemsStartTurnIndex) ||
              coordinates.itemsStartTurnIndex < 0)) ||
          (coordinates.turnCount !== undefined &&
            (!Number.isSafeInteger(coordinates.turnCount) || coordinates.turnCount < rows.length))
        )
          throw new Error('Invalid persisted coordinates')
        const items: ProviderChatItem[] = []
        for (const [index, row] of rows.entries()) {
          const turn = JSON.parse(row.payload) as ProviderChatItem[]
          if (
            row.position !== index ||
            turnIds[index] !== row.turn_id ||
            createHash('sha256').update(row.payload).digest('hex') !== row.content_hash ||
            !Array.isArray(turn) ||
            !turn.length ||
            turn[0].id !== row.turn_id
          )
            throw new Error('Invalid persisted turn')
          items.push(...turn)
        }
        if (!rows.length || rows.length > 10) throw new Error('Invalid persisted page')
        assertUniqueProviderChatItemIds(items)
        await db
          .updateTable('chat_history_page')
          .set({ accessed_at: this.now() })
          .where('cache_key', '=', key)
          .execute()
        return { ...coordinates, items }
      } catch (error) {
        console.warn('Discarding invalid chat history cache entry.', error)
        await db.deleteFrom('chat_history_turn').where('cache_key', '=', key).execute()
        await db.deleteFrom('chat_history_page').where('cache_key', '=', key).execute()
        return null
      }
    })
  }

  async save(
    key: string,
    fingerprint: string,
    history: CachedChatHistory,
    current: () => boolean
  ): Promise<boolean> {
    if (!current()) return false
    const { items, ...coordinates } = history
    const turns = getProviderChatTurns(items)
    if (!turns.length || turns.length > 10) return false
    assertUniqueProviderChatItemIds(items)
    const payloads = turns.map((turn, position) => {
      const payload = JSON.stringify(turn.items)
      return {
        cache_key: key,
        turn_id: turn.id,
        position,
        payload,
        content_hash: createHash('sha256').update(payload).digest('hex')
      }
    })
    const serializedCoordinates = JSON.stringify({
      ...coordinates,
      turnIds: turns.map((turn) => turn.id)
    })
    const bytes = payloads.reduce(
      (total, turn) => total + Buffer.byteLength(turn.payload),
      Buffer.byteLength(serializedCoordinates)
    )
    if (bytes > maxPageBytes || !current()) return false
    const db = await this.database()
    return db.transaction().execute(async (trx) => {
      if (!current()) return false
      const previous = await trx
        .selectFrom('chat_history_turn')
        .select(['turn_id', 'position', 'content_hash'])
        .where('cache_key', '=', key)
        .execute()
      const byId = new Map(previous.map((turn) => [turn.turn_id, turn]))
      const now = this.now()
      await trx
        .insertInto('chat_history_page')
        .values({
          cache_key: key,
          fingerprint,
          format_version: formatVersion,
          coordinates: serializedCoordinates,
          byte_size: bytes,
          saved_at: now,
          accessed_at: now
        })
        .onConflict((c) =>
          c.column('cache_key').doUpdateSet({
            fingerprint,
            format_version: formatVersion,
            coordinates: serializedCoordinates,
            byte_size: bytes,
            saved_at: now,
            accessed_at: now
          })
        )
        .execute()
      for (const turn of payloads) {
        const old = byId.get(turn.turn_id)
        if (old?.content_hash === turn.content_hash && old.position === turn.position) continue
        await trx
          .insertInto('chat_history_turn')
          .values(turn)
          .onConflict((c) =>
            c.columns(['cache_key', 'turn_id']).doUpdateSet({
              payload: turn.payload,
              position: turn.position,
              content_hash: turn.content_hash
            })
          )
          .execute()
      }
      await trx
        .deleteFrom('chat_history_turn')
        .where('cache_key', '=', key)
        .where(
          'turn_id',
          'not in',
          payloads.map((turn) => turn.turn_id)
        )
        .execute()
      const pages = await trx
        .selectFrom('chat_history_page')
        .select(['cache_key', 'byte_size', 'saved_at'])
        .orderBy('accessed_at', 'desc')
        .execute()
      let total = 0
      const remove: string[] = []
      for (const [index, page] of pages.entries()) {
        total += page.byte_size
        if (index >= maxPages || total > maxCacheBytes || page.saved_at < now - maxAgeMs)
          remove.push(page.cache_key)
      }
      if (!current() && !remove.includes(key)) remove.push(key)
      if (remove.length) {
        await trx.deleteFrom('chat_history_turn').where('cache_key', 'in', remove).execute()
        await trx.deleteFrom('chat_history_page').where('cache_key', 'in', remove).execute()
      }
      return current() && !remove.includes(key)
    })
  }
}
