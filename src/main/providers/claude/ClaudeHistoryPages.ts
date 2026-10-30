import { createHash, randomUUID } from 'node:crypto'
import type { SessionStoreEntry, SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderChatTurnCursorWindow } from '../ProviderAdapter'
import type { ProviderChatGoal, ProviderChatTurnPagination } from '../../../shared/provider'
import { readClaudeHistoryGoal } from './ClaudeGoals.ts'
import { classifyClaudeTurnRecord, type ClaudeTranscriptMessage } from './ClaudeItemRenderers.ts'
import { restoreClaudeHistory } from './ClaudeHistory.ts'
import { claudeHistoryBlockSize, type ClaudeHistorySource } from './ClaudeHistorySource.ts'

type Row = { offset: number; entry: SessionStoreEntry }
type Boundary = {
  id: string
  end: number
  leaf?: string | null
  newer: string | null
  older?: string | null
  limit: number
  itemIds?: string[]
}
type Snapshot = {
  sessionId: string
  scope: string
  identity: string
  size: number
  modified: number
  version?: string
  digest: string
  pages: Map<string, Boundary>
  latest: Boundary
}
export type ClaudeHistoryPage = {
  messages: ClaudeTranscriptMessage[]
  pagination: ProviderChatTurnPagination
  metadata: SDKSessionInfo
  /** Ids of user input Claude Code recorded on this page, including steering it folded in. */
  inputIds: string[]
  goal?: ProviderChatGoal | null
}
const getInputId = (entry: SessionStoreEntry): string | null => {
  if (entry.type === 'user') return typeof entry.uuid === 'string' ? entry.uuid : null
  const attachment = entry.type === 'attachment' ? entry.attachment : null
  return attachment &&
    typeof attachment === 'object' &&
    (attachment as { type?: unknown }).type === 'queued_command' &&
    typeof (attachment as { source_uuid?: unknown }).source_uuid === 'string'
    ? (attachment as { source_uuid: string }).source_uuid
    : null
}
const prefix = 'sele:claude-history:'
const digest = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')
const fingerprint = async (source: ClaudeHistorySource, size: number): Promise<string> =>
  digest(await source.read(Math.max(0, size - 4096), Math.min(size, 4096)))

/** File snapshots and page boundaries only. Message bodies are never cached here. */
export class ClaudeHistoryPages {
  private generation = 0
  private snapshots = new Map<string, Snapshot>()
  private latest = new Map<string, string>()

  clear(): void {
    this.generation += 1
    this.snapshots.clear()
    this.latest.clear()
  }

  rememberItems(pagination: ProviderChatTurnPagination, items: readonly { id: string }[]): void {
    const neighbor = pagination.olderCursor ?? pagination.newerCursor
    if (!neighbor?.startsWith(prefix)) return
    const [snapshotId, pageId] = neighbor.slice(prefix.length).split('/')
    const snapshot = this.snapshots.get(snapshotId)
    const page = snapshot?.pages.get(pageId)
    const id = pagination.olderCursor ? page?.newer : page?.older
    const current = id ? snapshot?.pages.get(id) : undefined
    if (current) current.itemIds = items.map((item) => item.id)
  }

  findItemCursor(sessionId: string, scope: string, itemId: string): string | null {
    for (const [snapshotId, snapshot] of [...this.snapshots].reverse()) {
      if (snapshot.sessionId !== sessionId || snapshot.scope !== scope) continue
      for (const [id, page] of snapshot.pages) {
        if (
          page.itemIds?.some(
            (candidate) => itemId === candidate || itemId.startsWith(`${candidate}:`)
          )
        )
          return `${prefix}${snapshotId}/${id}`
      }
    }
    return null
  }

  async read(
    sessionId: string,
    scope: string,
    window: ProviderChatTurnCursorWindow,
    openSource: () => Promise<ClaudeHistorySource>,
    includeSidechain = false
  ): Promise<ClaudeHistoryPage> {
    const generation = this.generation
    const source = await openSource()
    try {
      if (generation !== this.generation) throw new Error('Claude history reader was reset')
      let snapshot: Snapshot
      let boundary: Boundary
      let snapshotId: string
      if (window.cursor) {
        if (!window.cursor.startsWith(prefix)) throw new Error('Invalid Claude history cursor')
        const [id, pageId] = window.cursor.slice(prefix.length).split('/')
        const saved = this.snapshots.get(id)
        const page = saved?.pages.get(pageId)
        if (!saved || !page || saved.sessionId !== sessionId || saved.scope !== scope)
          throw new Error('Claude history cursor expired. Reopen the conversation.')
        snapshot = saved
        snapshotId = id
        boundary = page
        if (
          source.identity !== snapshot.identity ||
          source.size < snapshot.size ||
          (source.size === snapshot.size && source.modified !== snapshot.modified) ||
          (source.size === snapshot.size && source.version !== snapshot.version) ||
          (await fingerprint(source, snapshot.size)) !== snapshot.digest
        )
          throw new Error('Claude history changed. Reopen the conversation.')
      } else {
        const key = `${scope}:${sessionId}`
        const previousId = this.latest.get(key)
        const previous = previousId ? this.snapshots.get(previousId) : undefined
        const signature = await fingerprint(source, source.size)
        if (
          previous &&
          previous.identity === source.identity &&
          previous.size === source.size &&
          previous.modified === source.modified &&
          previous.digest === signature &&
          previous.version === source.version &&
          previous.latest.limit === window.limit
        ) {
          snapshot = previous
          snapshotId = previousId!
        } else {
          snapshotId = randomUUID()
          boundary = {
            id: randomUUID(),
            end: source.size,
            newer: null,
            limit: Math.max(1, Math.floor(window.limit))
          }
          snapshot = {
            sessionId,
            scope,
            identity: source.identity,
            size: source.size,
            modified: source.modified,
            version: source.version,
            digest: signature,
            pages: new Map([[boundary.id, boundary]]),
            latest: boundary
          }
          this.snapshots.set(snapshotId, snapshot)
          this.latest.set(key, snapshotId)
        }
        boundary = snapshot.latest
      }
      const { messages, rows, first } = await this.readBoundary(
        source,
        sessionId,
        boundary,
        includeSidechain
      )
      if (boundary.older === undefined) {
        const parent =
          first?.entry.type === 'system' && first.entry.subtype === 'compact_boundary'
            ? (first.entry.logicalParentUuid ?? first.entry.parentUuid)
            : first?.entry.parentUuid
        if (first && first.offset > 0 && typeof parent === 'string') {
          const older: Boundary = {
            id: randomUUID(),
            end: first.offset,
            leaf: parent,
            newer: boundary.id,
            limit: boundary.limit
          }
          snapshot.pages.set(older.id, older)
          boundary.older = older.id
        } else boundary.older = null
      }
      const token = (id: string | null | undefined): string | null =>
        id ? `${prefix}${snapshotId}/${id}` : null
      const head = await source.read(0, Math.min(snapshot.size, 16 * 1024))
      const header: SessionStoreEntry[] = []
      for (const line of head.toString('utf8').split('\n').slice(0, -1)) {
        try {
          const entry = JSON.parse(line)
          if (entry && typeof entry === 'object' && typeof entry.type === 'string')
            header.push(entry)
        } catch (error) {
          console.error('Unable to parse Claude history metadata.', error)
        }
      }
      const raw = [...header, ...rows.map((row) => row.entry)]
      // The SDK freezes the session cwd on first sight. Later records can carry
      // another working directory; using those would move an opened chat into
      // a different sidebar project than the SDK's session listing.
      const origin = raw.find((entry) => typeof entry.cwd === 'string')
      const latest = raw.findLast((entry) => typeof entry.cwd === 'string')
      const title = raw.findLast((entry) => entry.type === 'custom-title')
      const firstPrompt = raw.find((entry) => entry.type === 'user' && entry.parentUuid == null)
      const content = firstPrompt?.message as { content?: unknown } | undefined
      const firstText =
        typeof content?.content === 'string'
          ? content.content
          : Array.isArray(content?.content)
            ? content.content
                .flatMap((block) =>
                  block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
                )
                .join('\n')
            : undefined
      // Do not publish a page read through a simultaneous truncate/rewrite.
      if (
        (await fingerprint(source, snapshot.size)) !== snapshot.digest ||
        (source.validate && !(await source.validate()))
      )
        throw new Error('Claude history changed while loading. Reopen the conversation.')
      if (generation !== this.generation) throw new Error('Claude history reader was reset')
      return {
        messages,
        pagination: {
          kind: 'cursor',
          olderCursor: token(boundary.older),
          newerCursor: token(boundary.newer)
        },
        metadata: {
          sessionId,
          summary: typeof title?.customTitle === 'string' ? title.customTitle : '',
          customTitle: typeof title?.customTitle === 'string' ? title.customTitle : undefined,
          firstPrompt: firstText,
          createdAt:
            typeof firstPrompt?.timestamp === 'string'
              ? Date.parse(firstPrompt.timestamp)
              : undefined,
          cwd: typeof origin?.cwd === 'string' ? origin.cwd : undefined,
          gitBranch: typeof latest?.gitBranch === 'string' ? latest.gitBranch : undefined,
          lastModified: snapshot.modified
        },
        inputIds: rows.flatMap((row) => getInputId(row.entry) ?? []),
        goal: readClaudeHistoryGoal(
          sessionId,
          rows.map((row) => row.entry)
        )
      }
    } finally {
      await source.close()
    }
  }

  private async readBoundary(
    source: ClaudeHistorySource,
    sessionId: string,
    boundary: Boundary,
    includeSidechain: boolean
  ) {
    const batches: Row[][] = []
    let nextRestoreBytes = 0
    let rows: Row[] = []
    let position = boundary.end
    let pending: Buffer[] = []
    let messages: ClaudeTranscriptMessage[] = []
    let starts: number[] = []
    while (position > 0) {
      const offset = Math.max(0, position - claudeHistoryBlockSize)
      const block = await source.read(offset, position - offset)
      if (block.length !== position - offset) throw new Error('Claude transcript was truncated')
      const newline = block.indexOf(10)
      position = offset
      if (offset > 0 && newline < 0) {
        // A large JSON record can span many blocks. Retain chunks without repeatedly
        // copying the growing record; join it once its starting newline is known.
        pending.unshift(block)
        continue
      }
      // Keep a split UTF-8 codepoint/JSON record as bytes until the complete line is available.
      const completeStart = offset === 0 ? 0 : newline + 1
      const complete = Buffer.concat([block.subarray(completeStart), ...pending])
      pending = [block.subarray(0, completeStart)]
      let lineOffset = offset + completeStart
      const added: Row[] = []
      for (const line of complete.toString('utf8').split('\n')) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line)
            if (entry && typeof entry === 'object' && typeof entry.type === 'string')
              added.push({ offset: lineOffset, entry })
          } catch (error) {
            // Claude can be appending its final line. Match the SDK's tolerant JSONL reader.
            if (lineOffset + Buffer.byteLength(line) !== boundary.end)
              console.error('Unable to parse a Claude history record.', error)
          }
        }
        lineOffset += Buffer.byteLength(line) + 1
      }
      if (!added.length && position > 0) continue
      batches.push(added)
      // Rebuilding the entire accumulated chain after every 64 KiB block is quadratic
      // for tool-heavy turns. Double the byte budget between SDK recoveries, keeping
      // cumulative recovery input linear and read-ahead bounded even for large records.
      // EOF always gets a final recovery.
      const readBytes = boundary.end - position
      if (position > 0 && readBytes < nextRestoreBytes) continue
      rows = batches.toReversed().flat()
      nextRestoreBytes = readBytes * 2
      messages = await restoreClaudeHistory(
        sessionId,
        rows.map((row) => row.entry),
        boundary.leaf,
        includeSidechain
      )
      starts = []
      messages.forEach((message, index) => {
        const kind = classifyClaudeTurnRecord(message)
        if (kind === 'start' || (kind === 'content' && starts.length === 0)) starts.push(index)
      })
      // Child viewers replace cursor pages, so a tool run can continue on an older
      // page without reading back to its original delegation prompt.
      if (
        includeSidechain &&
        messages.some(
          (message) => message.type === 'assistant' || classifyClaudeTurnRecord(message) === 'start'
        )
      )
        break
      const first = starts[Math.max(0, starts.length - boundary.limit)]
      if (
        first !== undefined &&
        starts.length >= boundary.limit &&
        classifyClaudeTurnRecord(messages[first]) === 'start'
      )
        break
    }
    const start = includeSidechain ? 0 : (starts[Math.max(0, starts.length - boundary.limit)] ?? 0)
    const selected = messages.slice(start)
    const first = rows.findLast((row) => row.entry.uuid === selected[0]?.uuid)
    return { messages: selected, rows, first }
  }
}
