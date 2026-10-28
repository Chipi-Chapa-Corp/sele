import { randomUUID } from 'node:crypto'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import type { ProviderChatTurnCursorWindow } from '../ProviderAdapter'
import type { ProviderChatTurnPagination } from '../../../shared/provider'
import {
  classifyOpenCodeTurnRecord,
  type OpenCodeMessageWithParts
} from './OpenCodeItemRenderers.ts'

// History responses contain tool bodies. Small native pages keep a cold open from
// decoding many unrelated megabytes just to fill a nominal ten-turn viewport.
const messagePageSize = 8
const prefix = 'sele:opencode-history:'
type Boundary = {
  sessionId: string
  directory: string
  client: OpencodeClient
  before?: string
  suffix?: string[]
  startId?: string
  newer: string | null
  limit: number
  older?: string | null
}
export type OpenCodeHistoryPage = {
  messages: OpenCodeMessageWithParts[]
  pagination: ProviderChatTurnPagination
}

/** Retain navigation boundaries, never historical message/tool bodies. */
export class OpenCodeHistoryPages {
  private boundaries = new Map<string, Boundary>()

  isLatest(cursor: string, pagination: ProviderChatTurnPagination): boolean {
    return Boolean(
      pagination.olderCursor &&
        this.boundaries.get(pagination.olderCursor)?.newer === cursor &&
        this.boundaries.get(cursor)?.newer === null
    )
  }

  async read(
    client: OpencodeClient,
    session: { id: string; directory: string },
    window: ProviderChatTurnCursorWindow
  ): Promise<OpenCodeHistoryPage> {
    const token = window.cursor ?? `${prefix}${randomUUID()}`
    const boundary = window.cursor
      ? this.boundaries.get(token)
      : {
          sessionId: session.id,
          directory: session.directory,
          client,
          newer: null,
          limit: Math.max(1, Math.floor(window.limit))
        }
    if (
      !boundary ||
      boundary.sessionId !== session.id ||
      boundary.directory !== session.directory ||
      boundary.client !== client
    )
      throw new Error('OpenCode history cursor expired. Reopen the conversation.')

    const limit = boundary.limit
    let before = boundary.before
    const seen = new Set<string>()
    // A native response can begin midway through an older turn. Retain only the
    // IDs of that overlap, and re-read them individually when scrolling there.
    // Replaying an unanchored latest-page request would shift after live appends.
    const suffix = await Promise.all(
      (boundary.suffix ?? []).map(async (messageID) => {
        const result = await client.session.message(
          { sessionID: session.id, directory: session.directory, messageID },
          { throwOnError: true }
        )
        return result.data
      })
    )
    const chunks: OpenCodeMessageWithParts[][] = [suffix]
    let messages: OpenCodeMessageWithParts[]
    let first = 0
    let hasMore = boundary.suffix === undefined || Boolean(before)
    for (;;) {
      messages = chunks.flat()
      const starts = messages.flatMap((record, index) =>
        classifyOpenCodeTurnRecord(record) === 'start' ? [index] : []
      )
      first = boundary.startId
        ? messages.findIndex((record) => record.info.id === boundary.startId)
        : (starts[Math.max(0, starts.length - limit)] ?? 0)
      if (boundary.startId && first < 0 && !hasMore)
        throw new Error('OpenCode history changed. Reopen the conversation.')
      // Stop as soon as a response contains a complete turn start. A cursor page
      // may contain fewer than the requested maximum number of turns.
      if (boundary.startId ? first >= 0 : starts.length || !hasMore) break
      const result = await client.session.messages(
        {
          sessionID: session.id,
          directory: session.directory,
          limit: Math.min(messagePageSize, limit * 2),
          ...(before ? { before } : {})
        },
        { throwOnError: true }
      )
      chunks.unshift(result.data)
      const next = result.response.headers.get('x-next-cursor') || undefined
      if (next && (seen.has(next) || next === before))
        throw new Error('OpenCode history pagination did not advance.')
      if (next) seen.add(next)
      before = next
      hasMore = Boolean(next)
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    // The newest page grows from its original start when revisited after appends;
    // shifting it to a fresh tail would skip turns between this page and its older neighbor.
    if (boundary.suffix === undefined && messages[first]) boundary.startId = messages[first].info.id
    if ((first > 0 || hasMore) && messages[first]) {
      const older = boundary.older ?? `${prefix}${randomUUID()}`
      this.boundaries.set(older, {
        sessionId: session.id,
        directory: session.directory,
        client,
        before,
        suffix: messages.slice(0, first).map((record) => record.info.id),
        newer: token,
        limit
      })
      boundary.older = older
    } else boundary.older = null
    this.boundaries.set(token, boundary)
    // Old navigation tokens can be recreated by reopening; bound metadata too.
    while (this.boundaries.size > 2000) this.boundaries.delete(this.boundaries.keys().next().value!)
    return {
      messages: messages.slice(first),
      pagination: { kind: 'cursor', olderCursor: boundary.older, newerCursor: boundary.newer }
    }
  }
}
