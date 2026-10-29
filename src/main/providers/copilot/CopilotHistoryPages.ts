import { randomUUID } from 'node:crypto'
import type { CopilotSession, SessionEvent } from '@github/copilot-sdk'
import type { ProviderChatTurnPagination } from '../../../shared/provider'
import type { ProviderChatTurnCursorWindow } from '../ProviderAdapter'
import { classifyCopilotTurnRecord } from './CopilotItemRenderers.ts'

const prefix = 'sele:copilot-history:'
const eventPageSize = 64

type Boundary = {
  session: CopilotSession
  agentId?: string
  before?: string
  endId?: string
  startId?: string
  max: number
  limit: number
  newer: string | null
  older?: string | null
  itemIds?: string[]
}
export type CopilotHistoryPage = { events: SessionEvent[]; pagination: ProviderChatTurnPagination }

/** Uses the replayable session event log, not single-use persisted-journal cursors. */
export class CopilotHistoryPages {
  private boundaries = new Map<string, Boundary>()

  isLatest(cursor: string, pagination: ProviderChatTurnPagination): boolean {
    return Boolean(
      pagination.olderCursor &&
        this.boundaries.get(pagination.olderCursor)?.newer === cursor &&
        this.boundaries.get(cursor)?.newer === null
    )
  }

  rememberItems(pagination: ProviderChatTurnPagination, items: readonly { id: string }[]): void {
    const token =
      (pagination.olderCursor ? this.boundaries.get(pagination.olderCursor)?.newer : null) ??
      (pagination.newerCursor ? this.boundaries.get(pagination.newerCursor)?.older : null)
    const page = token ? this.boundaries.get(token) : undefined
    if (page) page.itemIds = items.map((item) => item.id)
  }

  findItemCursor(session: CopilotSession, itemId: string, agentId?: string): string | null {
    for (const [token, boundary] of [...this.boundaries].reverse()) {
      if (
        boundary.session === session &&
        boundary.agentId === agentId &&
        boundary.itemIds?.some((id) => itemId === id || itemId.startsWith(`${id}:`))
      )
        return token
    }
    return null
  }

  async read(
    session: CopilotSession,
    window: ProviderChatTurnCursorWindow,
    agentId?: string
  ): Promise<CopilotHistoryPage> {
    const token = window.cursor ?? `${prefix}${randomUUID()}`
    const boundary: Boundary | undefined = window.cursor
      ? this.boundaries.get(token)
      : {
          session,
          agentId,
          max: 1,
          limit: Math.max(1, Math.floor(window.limit)),
          newer: null
        }
    if (!boundary || boundary.session !== session || boundary.agentId !== agentId)
      throw new Error('Copilot history cursor expired. Reopen the conversation.')
    let before = boundary.before
    let max = boundary.max
    const seen = new Set<string>()
    const chunks: SessionEvent[][] = []
    let events: SessionEvent[]
    let first = 0
    let olderBefore: string | undefined
    let olderEnd: string | undefined
    let hasOlder = false
    for (;;) {
      const page = await this.readNative(session, before, max, agentId)
      let added = page.events
      if (!chunks.length && boundary.endId) {
        const end = added.findIndex((event) => event.id === boundary.endId)
        if (end < 0) throw new Error('Copilot history changed. Reopen the conversation.')
        added = added.slice(0, end)
      }
      chunks.unshift(added)
      events = chunks.flat()
      const starts = events.flatMap((event, index) =>
        classifyCopilotTurnRecord(
          agentId ? ({ ...event, agentId: undefined } as SessionEvent) : event
        ) === 'start'
          ? [index]
          : []
      )
      first = boundary.startId
        ? events.findIndex((event) => event.id === boundary.startId)
        : agentId
          ? 0
          : (starts[Math.max(0, starts.length - boundary.limit)] ?? 0)
      if (page.hasMore && (seen.has(page.cursor) || page.cursor === before))
        throw new Error('Copilot history pagination did not advance.')
      if (boundary.startId && first < 0 && !page.hasMore)
        throw new Error('Copilot history changed. Reopen the conversation.')
      const hasContent = events.some(
        (event) =>
          classifyCopilotTurnRecord(
            agentId ? ({ ...event, agentId: undefined } as SessionEvent) : event
          ) !== 'ignore'
      )
      if (
        boundary.startId
          ? first >= 0
          : ((agentId || chunks.length > 1) && hasContent) || starts.length || !page.hasMore
      ) {
        if (first > 0) {
          // This request was anchored by a server cursor (the initial one-event
          // read cannot have a partial prefix). Re-read only that overlap on scroll.
          olderBefore = before
          olderEnd = events[first].id
        } else olderBefore = page.hasMore ? page.cursor : undefined
        hasOlder = first > 0 || page.hasMore
        break
      }
      seen.add(page.cursor)
      before = page.cursor
      max = eventPageSize
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (!window.cursor && events[first]) boundary.startId = events[first].id
    if (hasOlder && events[first]) {
      const older = boundary.older ?? `${prefix}${randomUUID()}`
      this.boundaries.set(older, {
        session,
        agentId,
        before: olderBefore,
        endId: olderEnd,
        max: eventPageSize,
        limit: boundary.limit,
        newer: token
      })
      boundary.older = older
    } else boundary.older = null
    this.boundaries.set(token, boundary)
    while (this.boundaries.size > 2000) this.boundaries.delete(this.boundaries.keys().next().value!)
    const assets = events.slice(0, first).filter((event) => event.type === 'session.binary_asset')
    return {
      events: [...assets, ...events.slice(first)],
      pagination: {
        kind: 'cursor',
        olderCursor: boundary.older,
        newerCursor: boundary.newer
      }
    }
  }

  async subagents(session: CopilotSession): Promise<SessionEvent[]> {
    const events: SessionEvent[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const page = await session.rpc.eventLog.read({
        cursor,
        max: eventPageSize,
        direction: 'backward',
        includeEphemeral: false,
        agentScope: 'all',
        types: ['subagent.started', 'subagent.completed', 'subagent.failed']
      })
      if (page.cursorStatus !== 'ok') throw new Error('Copilot subagent history cursor expired.')
      events.unshift(...page.events)
      if (!page.hasMore) return events
      if (seen.has(page.cursor) || page.cursor === cursor)
        throw new Error('Copilot history pagination did not advance.')
      seen.add(page.cursor)
      cursor = page.cursor
    }
  }

  async inputsSince(session: CopilotSession, timestamp: number): Promise<SessionEvent[]> {
    const inputs: SessionEvent[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const page = await session.rpc.eventLog.read({
        cursor,
        max: eventPageSize,
        direction: 'backward',
        includeEphemeral: false,
        agentScope: 'primary',
        types: ['user.message']
      })
      if (page.cursorStatus !== 'ok') throw new Error('Copilot input history cursor expired.')
      inputs.unshift(...page.events)
      if (!page.hasMore || page.events.some((event) => Date.parse(event.timestamp) < timestamp))
        return inputs
      if (seen.has(page.cursor) || page.cursor === cursor)
        throw new Error('Copilot history pagination did not advance.')
      seen.add(page.cursor)
      cursor = page.cursor
    }
  }

  async complete(session: CopilotSession): Promise<SessionEvent[]> {
    const chunks: SessionEvent[][] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    for (;;) {
      const page = await this.readNative(session, cursor, eventPageSize)
      chunks.unshift(page.events)
      if (!page.hasMore) return chunks.flat()
      if (seen.has(page.cursor) || page.cursor === cursor)
        throw new Error('Copilot history pagination did not advance.')
      seen.add(page.cursor)
      cursor = page.cursor
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  private async readNative(
    session: CopilotSession,
    cursor: string | undefined,
    max: number,
    agentId?: string
  ) {
    if (!session.rpc?.eventLog?.read)
      throw new Error(
        'Copilot paged history is unavailable. Update Copilot and reopen the conversation.'
      )
    const result = await session.rpc.eventLog.read({
      cursor,
      max,
      direction: 'backward',
      includeEphemeral: false,
      ...(agentId ? { agentIds: [agentId] } : { agentScope: 'primary' })
    })
    if (result.cursorStatus !== 'ok')
      throw new Error('Copilot history cursor expired. Reopen the conversation.')
    return {
      ...result,
      events: agentId
        ? result.events.map((event) => ({ ...event, agentId }) as SessionEvent)
        : result.events
    }
  }
}
