import { sql, type Kysely } from 'kysely'
import type { LocalDatabase } from './sqlite'
import type { ProviderChat, ProviderChatDetail } from '../../shared/provider'
import { getConversationViewSummary } from '../../shared/conversationView'
import { assertUniqueProviderChatItemIds } from '../../shared/chatTurns.ts'
import type { ConversationViewScope } from '../providers/PersistentChatHistory'

/** A durable read model, not an expiring/LRU cache. The processed message list for each chat. */
export class SqliteConversationViews {
  constructor(private database: () => Promise<Kysely<LocalDatabase>>) {}

  async list(
    scope: ConversationViewScope,
    offset: number,
    limit: number
  ): Promise<{ summaries: Omit<ProviderChat, 'providerId'>[]; nextCursor: string | null }> {
    const namespace = JSON.stringify(JSON.parse(scope.key).slice(0, -1)).slice(0, -1) + ','
    const db = await this.database()
    const rows = await db
      .selectFrom('conversation_view')
      .select([
        'format_version',
        // Old rows are projected inside the SQLite worker, never parsed or
        // transferred as full transcripts on the main/renderer threads.
        sql<string>`coalesce(summary, case when json_valid(payload) then json_remove(payload, '$.items', '$.subagents',
          '$.promptSuggestion', '$.pendingApproval', '$.pendingUserInput', '$.contextUsage',
          '$.tokenUsage', '$.goal') else null end)`.as('summary')
      ])
      .where('scope_key', '>=', namespace)
      .where('scope_key', '<', namespace + '\uffff')
      .orderBy('scope_key')
      .offset(offset)
      .limit(limit + 1)
      .execute()
    if (!scope.current()) return { summaries: [], nextCursor: null }
    const summaries: Omit<ProviderChat, 'providerId'>[] = []
    for (const row of rows.slice(0, limit)) {
      if (row.format_version !== 1) continue
      try {
        const summary = JSON.parse(row.summary)
        if (
          typeof summary.id !== 'string' ||
          typeof summary.title !== 'string' ||
          'items' in summary
        )
          throw new Error('Invalid conversation summary')
        summaries.push({
          ...summary,
          updatedAt: summary.updatedAt ?? summary.createdAt,
          preview: summary.preview ?? '',
          pendingApproval: null
        })
      } catch (error) {
        console.warn('Unable to read conversation summary.', error)
      }
    }
    return {
      summaries,
      nextCursor: rows.length > limit ? String(offset + limit) : null
    }
  }

  async read(
    scopes: ConversationViewScope[],
    _options: { opening?: boolean } = {}
  ): Promise<Map<string, ProviderChatDetail>> {
    const result = new Map<string, ProviderChatDetail>()
    if (!scopes.length) return result
    const db = await this.database()
    // Read the saved message list directly. Legacy truncated opening columns
    // are ignored so selection cannot show a different list before refresh.
    const rows = await db
      .selectFrom('conversation_view')
      .select(['scope_key', 'format_version', 'payload'])
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
        delete view.promptSuggestion
        delete view.openingPreview
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
    const payload = JSON.stringify({
      ...view,
      promptSuggestion: undefined,
      openingPreview: undefined
    })
    const summary = JSON.stringify(getConversationViewSummary(view))
    const db = await this.database()
    if (!current()) return false
    await db
      .insertInto('conversation_view')
      .values({
        scope_key: scope.key,
        format_version: 1,
        payload,
        summary,
        opening: null,
        updated_at: Date.now()
      })
      .onConflict((c) =>
        c.column('scope_key').doUpdateSet({
          format_version: 1,
          payload,
          summary,
          opening: null,
          updated_at: Date.now()
        })
      )
      .execute()
    return current()
  }
}
