import { sql, type Kysely } from 'kysely'
import type { LocalDatabase } from './sqlite'
import type { ProviderChat, ProviderChatDetail } from '../../shared/provider'
import {
  createConversationOpening,
  getConversationViewSummary
} from '../../shared/conversationView'
import { assertUniqueProviderChatItemIds } from '../../shared/chatTurns.ts'
import type { ConversationViewScope } from '../providers/PersistentChatHistory'

/** A durable read model, not an expiring/LRU cache. One opening viewport per processed chat. */
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
    options: { opening?: boolean } = {}
  ): Promise<Map<string, ProviderChatDetail>> {
    const result = new Map<string, ProviderChatDetail>()
    if (!scopes.length) return result
    const db = await this.database()
    // Projection runs in the SQLite worker: neither the main thread nor the
    // renderer parses/transfers megabytes just to reveal the newest viewport.
    const rows = await db
      .selectFrom('conversation_view')
      .select([
        'scope_key',
        'format_version',
        'opening',
        options.opening
          ? sql<string>`coalesce(opening, case when length(payload) <= 32768 then payload
          when json_valid(payload) then json_set(
            coalesce(summary, json_remove(payload, '$.items', '$.subagents', '$.promptSuggestion', '$.pendingApproval', '$.pendingUserInput', '$.contextUsage', '$.tokenUsage', '$.goal')),
            '$.openingPreview', json('true'), '$.conversationView', json('true'), '$.historyPreview', json('true'), '$.revision', -1,
            '$.conversationViewSourceRevision', json_extract(payload, '$.conversationViewSourceRevision'),
            '$.itemsStartTurnIndex', json_extract(payload, '$.itemsStartTurnIndex'),
            '$.turnCount', json_extract(payload, '$.turnCount'),
            '$.turnPagination', json_extract(payload, '$.turnPagination'),
            '$.contextUsage', null,
            '$.items', json((select json_group_array(json(projected)) from (
              select item.key, case when json_extract(item.value, '$.type') = 'working'
                then json_object('id', json_extract(item.value, '$.id'), 'type', 'working',
                  'status', json_extract(item.value, '$.status'), 'items', json('[]'),
                  'itemsLoaded', json('false'), 'itemCount', coalesce(json_extract(item.value, '$.itemCount'), json_array_length(item.value, '$.items')),
                  'failureReason', json_extract(item.value, '$.failureReason'))
                else json_object('id', json_extract(item.value, '$.id'), 'type', json_extract(item.value, '$.type'),
                  'role', coalesce(json_extract(item.value, '$.role'), 'user'),
                  'kind', json_extract(item.value, '$.kind'), 'editable', json('false'),
                  'content', substr(coalesce(json_extract(item.value, '$.content'), ''), -8192),
                  'contentCharacterCount', length(coalesce(json_extract(item.value, '$.content'), '')),
                  'contentLoaded', json('false'), 'contentTruncated', json('true'),
                  'createdAt', json_extract(item.value, '$.createdAt')) end as projected
              from json_each(payload, '$.items') item
              where item.key in (select recent.key from json_each(payload, '$.items') recent
                where json_extract(recent.value, '$.type') in ('message', 'pendingMessage')
                order by cast(recent.key as integer) desc limit 2)
                or item.key = (select work.key from json_each(payload, '$.items') work
                  where json_extract(work.value, '$.type') = 'working'
                  order by cast(work.key as integer) desc limit 1)
              order by cast(item.key as integer)
            )))
          ) else null end)`.as('payload')
          : 'payload'
      ])
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
        result.set(row.scope_key, view)
        if (options.opening && row.opening == null && current.get(row.scope_key)?.()) {
          // Lazily upgrade only this requested legacy row. A concurrent full
          // snapshot always writes its own opening, so this cannot roll it back.
          void db
            .updateTable('conversation_view')
            .set({ opening: row.payload })
            .where('scope_key', '=', row.scope_key)
            .where('opening', 'is', null)
            .execute()
            .catch((error: unknown) => console.warn('Unable to save bounded chat opening.', error))
        }
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
    const payload = JSON.stringify({ ...view, promptSuggestion: undefined })
    const summary = JSON.stringify(getConversationViewSummary(view))
    const opening =
      payload.length <= 32768 ? payload : JSON.stringify(createConversationOpening(view))
    const db = await this.database()
    if (!current()) return false
    await db
      .insertInto('conversation_view')
      .values({
        scope_key: scope.key,
        format_version: 1,
        payload,
        summary,
        opening,
        updated_at: Date.now()
      })
      .onConflict((c) =>
        c.column('scope_key').doUpdateSet({
          format_version: 1,
          payload,
          summary,
          opening,
          updated_at: Date.now()
        })
      )
      .execute()
    return current()
  }
}
