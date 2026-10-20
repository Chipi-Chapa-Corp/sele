import { historyMessageId } from './NativeHistoryImport.ts'
import { transcriptMessages } from './ChatTranscript.ts'
import { randomUUID } from 'node:crypto'
import type { ProviderChatDetail, ProviderChatItem } from '../../shared/provider.ts'
import {
  getProviderChatTurnStartItemIndexes,
  sliceProviderChatTurns,
  unloadWorkingStepItems
} from '../../shared/chatTurns.ts'
import type { ProviderAdapter, ProviderChatTurnCursorWindow } from './ProviderAdapter.ts'
import type { ImportedConversation } from './ImportedConversations.ts'

type Read = () => Promise<ProviderChatDetail>
type Page = { read?: Read; pending?: Promise<ProviderChatDetail>; detail?: ProviderChatDetail }

/** UI reads and stream updates never hydrate the complete native transcript or archived tools. */
export class ImportedHistoryView {
  private pages = new Map<string, Page>()
  private starts: number[]
  private baseline: Set<string>
  private decorate: (detail: ProviderChatDetail, items: ProviderChatItem[]) => ProviderChatDetail
  private archived: (items: ProviderChatItem[]) => ProviderChatItem[]
  private adapter: ProviderAdapter
  private record: ImportedConversation
  private buildingSignature: string | undefined
  private liveSignature: string | undefined
  private livePage: Page | undefined
  private liveRevision = -1
  private liveDetail: ProviderChatDetail | undefined
  private scope = `sele:import:${randomUUID()}:`
  constructor(
    record: ImportedConversation,
    adapter: ProviderAdapter,
    archived: (items: ProviderChatItem[]) => ProviderChatItem[],
    decorate: (detail: ProviderChatDetail, items: ProviderChatItem[]) => ProviderChatDetail
  ) {
    this.record = record
    this.adapter = adapter
    this.archived = archived
    this.decorate = decorate
    this.starts = getProviderChatTurnStartItemIndexes(record.archive.chat.items)
    this.baseline = new Set(record.baseline)
    // Early versions could accept an empty native baseline after a truncated container write.
    // Recovered imports keep the same deterministic IDs; never display that context twice.
    if (record.providerId === 'claude' && !record.baseline.length)
      for (const [index, message] of transcriptMessages(record.archive.chat.items).entries()) {
        const id = historyMessageId(record.chatId, message, index)
        this.baseline.add(id)
        this.baseline.add(`${id}:working`)
        this.baseline.add(`msg_${id}:text:0`)
      }
    record.baseline = [...this.baseline]
  }
  private token(page: Page): string {
    const token = `${this.scope}${randomUUID()}`
    this.pages.set(token, page)
    // Keep bounded windows, not a second transcript cache.
    if (this.pages.size > 256) this.pages.delete(this.pages.keys().next().value!)
    return token
  }
  private page(
    detail: ProviderChatDetail,
    items: ProviderChatItem[],
    older: ((newer: string) => Promise<ProviderChatDetail>) | null,
    newer: string | null
  ): ProviderChatDetail {
    if (
      newer === null &&
      this.buildingSignature &&
      this.buildingSignature === this.liveSignature &&
      this.livePage?.detail
    ) {
      const detailPage = {
        ...this.decorate(detail, items),
        itemsStartTurnIndex: 0,
        turnCount: undefined,
        turnPagination: this.livePage.detail.turnPagination
      }
      this.livePage.detail = detailPage
      return detailPage
    }
    const page: Page = {}
    const token = this.token(page)
    const olderCursor = older ? this.token({ read: () => older(token) }) : null
    page.detail = {
      ...this.decorate(detail, items),
      itemsStartTurnIndex: 0,
      turnCount: undefined,
      turnPagination: { kind: 'cursor', olderCursor, newerCursor: newer }
    }
    if (newer === null && this.buildingSignature) {
      this.livePage = page
      this.liveSignature = this.buildingSignature
    }
    return page.detail
  }
  private range(start: number, end: number, hydrate = false): ProviderChatItem[] {
    const first = this.starts[start] ?? this.record.archive.chat.items.length
    const last = this.starts[end] ?? this.record.archive.chat.items.length
    const items = this.record.archive.chat.items.slice(first, last)
    return this.archived(
      hydrate
        ? items
        : items.map((item) => (item.type === 'working' ? unloadWorkingStepItems(item) : item))
    )
  }
  private archive(
    detail: ProviderChatDetail,
    end: number,
    limit: number,
    newer: string
  ): Promise<ProviderChatDetail> {
    const start = Math.max(0, end - limit)
    return Promise.resolve(
      this.page(
        detail,
        this.range(start, end),
        start ? (next) => this.archive(detail, start, limit, next) : null,
        newer
      )
    )
  }
  private async native(
    limit: number,
    newer: string | null,
    cursor?: string,
    startIndex?: number,
    readLimit = limit
  ): Promise<ProviderChatDetail> {
    const source = { container: this.record.container }
    const detail =
      cursor && this.adapter.getChatCursorWindow
        ? await this.adapter.getChatCursorWindow(
            this.record.chatId,
            { cursor, direction: 'older', limit },
            source
          )
        : this.adapter.getChatWindow
          ? await this.adapter.getChatWindow(
              this.record.chatId,
              { startIndex: startIndex ?? null, limit: readLimit },
              source
            )
          : await this.adapter.getChat(this.record.chatId, source)
    return this.fromNative(detail, limit, newer)
  }
  fromNative(
    detail: ProviderChatDetail,
    limit = 10,
    newer: string | null = null
  ): ProviderChatDetail {
    if (newer === null && this.liveDetail && detail.revision < this.liveRevision)
      return this.liveDetail
    const native = detail.items.filter((item) => !this.baseline.has(item.id))
    const baselineReached =
      detail.items.some((item) => this.baseline.has(item.id)) || native.length === 0
    const cursor = detail.turnPagination?.olderCursor
    const index = detail.itemsStartTurnIndex ?? 0
    const older =
      !baselineReached && cursor
        ? (next: string) => this.native(limit, next, cursor)
        : !baselineReached && index > 0
          ? (next: string) =>
              this.native(
                limit,
                next,
                undefined,
                Math.max(0, index - limit),
                Math.min(limit, index)
              )
          : null
    if (newer === null)
      this.buildingSignature = JSON.stringify([
        native[0]?.id,
        getProviderChatTurnStartItemIndexes(native).length,
        cursor,
        index,
        limit
      ])
    const page = this.nativeItems(detail, native, older, limit, newer)
    this.buildingSignature = undefined
    if (newer === null) {
      this.liveRevision = detail.revision
      this.liveDetail = page
    }
    return page
  }
  private nativeItems(
    detail: ProviderChatDetail,
    native: ProviderChatItem[],
    older: ((newer: string) => Promise<ProviderChatDetail>) | null,
    limit: number,
    newer: string | null
  ): ProviderChatDetail {
    const starts = getProviderChatTurnStartItemIndexes(native)
    const first = Math.max(0, starts.length - limit)
    const tail = first ? native.slice(starts[first]) : native
    if (first)
      return this.page(
        detail,
        tail,
        (next) =>
          Promise.resolve(
            this.nativeItems(detail, native.slice(0, starts[first]), older, limit, next)
          ),
        newer
      )
    // Do not jump over unseen native turns to the archive; traverse that provider's cursor first.
    if (older) return this.page(detail, tail, older, newer)
    const end = this.starts.length
    const start = Math.max(0, end - Math.max(0, limit - starts.length))
    return this.page(
      detail,
      [...this.range(start, end), ...tail],
      start ? (next) => this.archive(detail, start, limit, next) : null,
      newer
    )
  }
  latest(limit = 10): Promise<ProviderChatDetail> {
    return this.native(Math.max(1, limit), null)
  }
  async cursor(window: ProviderChatTurnCursorWindow): Promise<ProviderChatDetail> {
    if (!window.cursor) return this.latest(window.limit)
    const page = this.pages.get(window.cursor)
    if (!page) throw new Error('Imported chat history changed. Reopen the conversation.')
    const cached =
      page.detail ??
      (await (page.pending ??= page.read!().then((detail) => {
        page.detail = detail
        page.read = undefined
        return detail
      })))
    if (!this.liveDetail) return cached
    if (cached.turnPagination?.newerCursor === null) return this.liveDetail
    return {
      ...cached,
      ...this.liveDetail,
      items: cached.items,
      itemsStartTurnIndex: cached.itemsStartTurnIndex,
      turnCount: cached.turnCount,
      turnPagination: cached.turnPagination
    }
  }

  async item(id: string, limit: number): Promise<ProviderChatDetail> {
    if (id.startsWith('archive:')) {
      const sourceId = id.slice('archive:'.length)
      const index = this.record.archive.chat.items.findIndex((item) => item.id === sourceId)
      if (index < 0) throw new Error('Archived chat item not found.')
      const turn = this.starts.findLastIndex((start) => start <= index)
      const start = Math.max(0, turn - Math.floor(limit / 2))
      const detail = await (this.adapter.getChatWindow?.(
        this.record.chatId,
        { startIndex: null, limit: 1 },
        { container: this.record.container }
      ) ?? this.adapter.getChat(this.record.chatId, { container: this.record.container }))
      return {
        ...this.decorate(detail, this.range(start, start + limit, true)),
        itemsStartTurnIndex: start,
        turnCount: this.starts.length,
        turnPagination: undefined
      }
    }
    const detail = await (this.adapter.getChatWindowForItem?.(this.record.chatId, id, limit, {
      container: this.record.container
    }) ?? this.adapter.getChat(this.record.chatId, { container: this.record.container }))
    return this.fromNative(detail, limit)
  }
  // Numeric compatibility is bounded for archive-only views. Normal navigation uses cursors.
  async window(startIndex: number | null, limit: number): Promise<ProviderChatDetail> {
    if (startIndex == null) return this.latest(limit)
    if (limit === Number.MAX_SAFE_INTEGER)
      throw new Error('Use the explicit complete archive read.')
    if (startIndex + limit <= this.starts.length) {
      const detail = await this.native(1, null)
      return {
        ...detail,
        items: this.range(startIndex, startIndex + limit),
        itemsStartTurnIndex: startIndex,
        turnCount: this.starts.length,
        turnPagination: undefined
      }
    }
    let detail = await this.latest(limit)
    const pages: ProviderChatDetail[] = [detail]
    while (detail.turnPagination?.olderCursor) {
      detail = await this.cursor({
        cursor: detail.turnPagination.olderCursor,
        direction: 'older',
        limit
      })
      pages.unshift(detail)
    }
    const items = pages.flatMap((page) => page.items)
    return {
      ...detail,
      items: sliceProviderChatTurns(items, startIndex, startIndex + limit),
      itemsStartTurnIndex: startIndex,
      turnCount: getProviderChatTurnStartItemIndexes(items).length,
      turnPagination: undefined
    }
  }
}
