import type { Kysely } from 'kysely'
import type { LocalDatabase } from './sqlite'
import type { ProviderChatDetail } from '../../shared/provider'
import { assertUniqueProviderChatItemIds } from '../../shared/chatTurns.ts'
import type { ConversationViewScope } from '../providers/PersistentChatHistory'

/** A durable read model, not an expiring/LRU cache. One opening viewport per processed chat. */
export class SqliteConversationViews {
  constructor(private database: () => Promise<Kysely<LocalDatabase>>) {}

  async list(
    scope: ConversationViewScope,
    offset: number,
    limit: number
  ): Promise<{ views: ProviderChatDetail[]; nextCursor: string | null }> {
    const namespace = JSON.stringify(JSON.parse(scope.key).slice(0, -1)).slice(0, -1) + ','
    const db = await this.database()
    const keys = await db
      .selectFrom('conversation_view')
      .select('scope_key')
      .where('scope_key', '>=', namespace)
      .where('scope_key', '<', namespace + '\uffff')
      .orderBy('scope_key')
      .offset(offset)
      .limit(limit + 1)
      .execute()
    if (!scope.current()) return { views: [], nextCursor: null }
    const views = await this.read(
      keys.slice(0, limit).map((row) => ({ ...scope, key: row.scope_key }))
    )
    return {
      views: [...views.values()],
      nextCursor: keys.length > limit ? String(offset + limit) : null
    }
  }

  async read(scopes: ConversationViewScope[]): Promise<Map<string, ProviderChatDetail>> {
    const result = new Map<string, ProviderChatDetail>()
    if (!scopes.length) return result
    const db = await this.database()
    const rows = await db
      .selectFrom('conversation_view')
      .selectAll()
      .where(
        'scope_key',
        'in',
        scopes.map((scope) => scope.key)
      )
      .execute()
    const current = new Map(scopes.map((scope) => [scope.key, scope.current]))
    for (const row of rows) {
      if (!current.get(row.scope_key)?.()) continue
      if (row.format_version !== 1) continue
      try {
        const view = JSON.parse(row.payload) as ProviderChatDetail
        if (!view.conversationView || !Array.isArray(view.items) || typeof view.id !== 'string')
          throw new Error('Invalid conversation view')
        assertUniqueProviderChatItemIds(view.items)
        result.set(row.scope_key, view)
      } catch (error) {
        console.warn('Unable to read conversation view.', error)
      }
    }
    return result
  }

  async write(
    scope: ConversationViewScope,
    view: ProviderChatDetail,
    current = scope.current
  ): Promise<boolean> {
    if (!current()) return false
    assertUniqueProviderChatItemIds(view.items)
    const payload = JSON.stringify(view)
    const db = await this.database()
    if (!current()) return false
    await db
      .insertInto('conversation_view')
      .values({
        scope_key: scope.key,
        format_version: 1,
        payload,
        updated_at: Date.now()
      })
      .onConflict((c) =>
        c.column('scope_key').doUpdateSet({
          format_version: 1,
          payload,
          updated_at: Date.now()
        })
      )
      .execute()
    return current()
  }
}
