import { open, stat } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { StringDecoder } from 'node:string_decoder'
import { getCodexGoalPrompt, type CodexGoalPrompt } from './CodexGoalPrompts.ts'

export type CodexTranscriptMetadata = {
  prompts: Map<string, CodexGoalPrompt>
  starts: Map<string, Map<string, number>>
  version: number
}

export type TranscriptSource = {
  /** Includes the app-server/container identity, even when paths happen to match. */
  key: string
  threadId?: string
  path: string
  stat: () => Promise<{ size?: number; modifiedAtMs: number; identity?: string }>
  /** A ranged reader on local files; remote sources may only expose readAll. */
  read?: (offset: number, length: number) => Promise<Buffer>
  readAll?: () => Promise<Buffer>
}

type Entry = CodexTranscriptMetadata & {
  offset: number
  partialChunks: string[]
  partialLength: number
  decoder: StringDecoder
  modifiedAtMs: number
  identity?: string
  pending?: Promise<CodexTranscriptMetadata>
  generation: number
  currentTurnId: string | null
  head: Buffer | null
  tail: Buffer | null
  previewedPartialLength: number
}

const chunkSize = 128 * 1024
const maxEntries = 16

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null

const isExpectedCodexRolloutJsonError = (error: unknown): boolean => error instanceof SyntaxError

/** A source-local index of the two presentation fields used by Codex history. */
export class CodexTranscriptMetadataIndex {
  private entries = new Map<string, Entry>()
  private generation = 0

  clear(): void {
    this.generation++
    this.entries.clear()
  }

  async load(source: TranscriptSource): Promise<CodexTranscriptMetadata> {
    const key = `${source.key}\0${source.threadId ?? ''}\0${source.path}`
    let entry = this.entries.get(key)
    if (!entry) {
      entry = this.newEntry()
      this.entries.set(key, entry)
      while (this.entries.size > maxEntries) this.entries.delete(this.entries.keys().next().value!)
    } else {
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    if (entry.pending) return entry.pending
    const target = entry
    const request = this.update(target, source)
    target.pending = request
    try {
      return await request
    } catch (error) {
      // A failed read must be retried; do not preserve an incomplete file position.
      if (this.entries.get(key) === target) this.entries.delete(key)
      throw error
    } finally {
      if (target.pending === request) target.pending = undefined
    }
  }

  private newEntry(): Entry {
    return {
      prompts: new Map(),
      starts: new Map(),
      version: 0,
      offset: 0,
      partialChunks: [],
      partialLength: 0,
      decoder: new StringDecoder('utf8'),
      modifiedAtMs: -1,
      generation: this.generation,
      currentTurnId: null,
      head: null,
      tail: null,
      previewedPartialLength: 0
    }
  }

  private async update(entry: Entry, source: TranscriptSource): Promise<CodexTranscriptMetadata> {
    const info = await source.stat()
    if (entry.generation !== this.generation)
      throw Object.assign(new Error('Stale transcript metadata'), { code: 'ERR_CANCELED' })
    const replaced =
      (info.size !== undefined && info.size < entry.offset) ||
      (entry.identity !== undefined &&
        info.identity !== undefined &&
        entry.identity !== info.identity) ||
      (info.size !== undefined &&
        info.size === entry.offset &&
        entry.modifiedAtMs >= 0 &&
        info.modifiedAtMs !== entry.modifiedAtMs)
    if (replaced) {
      entry.prompts.clear()
      entry.starts.clear()
      entry.offset = 0
      entry.partialChunks = []
      entry.partialLength = 0
      entry.decoder = new StringDecoder('utf8')
      entry.currentTurnId = null
      entry.head = null
      entry.tail = null
      entry.previewedPartialLength = 0
      entry.version++
    }
    if (source.read) {
      const size = info.size
      if (size === undefined) throw new Error('Ranged transcript reader needs a file size')
      if (entry.offset && size >= entry.offset) {
        const head = await source.read(0, Math.min(256, size))
        const tailOffset = Math.max(0, entry.offset - 256)
        const tail = await source.read(tailOffset, entry.offset - tailOffset)
        if (
          (entry.head && !head.subarray(0, entry.head.length).equals(entry.head)) ||
          (entry.tail && !tail.equals(entry.tail))
        ) {
          entry.prompts.clear()
          entry.starts.clear()
          entry.offset = 0
          entry.partialChunks = []
          entry.partialLength = 0
          entry.decoder = new StringDecoder('utf8')
          entry.currentTurnId = null
          entry.previewedPartialLength = 0
          entry.version++
        }
      }
      const priorOffset = entry.offset
      while (entry.offset < size && entry.generation === this.generation) {
        const bytes = await source.read(entry.offset, Math.min(chunkSize, size - entry.offset))
        if (!bytes.length) break
        if (entry.offset === 0)
          entry.head = Buffer.from(bytes.subarray(0, Math.min(256, bytes.length)))
        entry.offset += bytes.length
        this.consume(entry, entry.decoder.write(bytes))
        await setImmediate()
      }
      if (entry.offset && entry.offset !== priorOffset)
        entry.tail = await source.read(Math.max(0, entry.offset - 256), Math.min(256, entry.offset))
    } else if (
      source.readAll &&
      (entry.offset === 0 || info.modifiedAtMs === 0 || info.modifiedAtMs !== entry.modifiedAtMs)
    ) {
      // The Codex app-server has no ranged fs/readFile API. Keep only the parsed index;
      // decode and parse its transport response in bounded slices, then release it.
      const bytes = await source.readAll()
      const head = bytes.subarray(0, Math.min(256, bytes.length))
      const previousTailOffset = Math.max(0, entry.offset - 256)
      const previousTail = bytes.subarray(previousTailOffset, entry.offset)
      if (
        bytes.length < entry.offset ||
        (entry.head && !head.subarray(0, entry.head.length).equals(entry.head)) ||
        (entry.tail && !previousTail.equals(entry.tail))
      ) {
        entry.prompts.clear()
        entry.starts.clear()
        entry.offset = 0
        entry.partialChunks = []
        entry.partialLength = 0
        entry.decoder = new StringDecoder('utf8')
        entry.currentTurnId = null
        entry.previewedPartialLength = 0
        entry.version++
      }
      entry.head = Buffer.from(head)
      for (
        let offset = entry.offset;
        offset < bytes.length && entry.generation === this.generation;
      ) {
        const end = Math.min(bytes.length, offset + chunkSize)
        this.consume(entry, entry.decoder.write(bytes.subarray(offset, end)))
        offset = end
        entry.offset = offset
        await setImmediate()
      }
      entry.tail = Buffer.from(bytes.subarray(Math.max(0, entry.offset - 256), entry.offset))
    }
    if (entry.generation !== this.generation)
      throw Object.assign(new Error('Stale transcript metadata'), { code: 'ERR_CANCELED' })
    entry.modifiedAtMs = info.modifiedAtMs
    entry.identity = info.identity
    if (entry.partialLength !== entry.previewedPartialLength) {
      const partial = entry.partialChunks.join('')
      this.consumeLine(entry, partial)
      entry.previewedPartialLength = entry.partialLength
    }
    return entry
  }

  private consume(entry: Entry, text: string): void {
    let start = 0
    for (let end = text.indexOf('\n'); end >= 0; end = text.indexOf('\n', start)) {
      const alreadyPreviewed =
        entry.partialLength > 0 &&
        entry.previewedPartialLength === entry.partialLength &&
        end === start
      if (!alreadyPreviewed) {
        const line = entry.partialChunks.length
          ? entry.partialChunks.join('') + text.slice(start, end)
          : text.slice(start, end)
        this.consumeLine(entry, line)
      }
      entry.partialChunks = []
      entry.partialLength = 0
      entry.previewedPartialLength = 0
      start = end + 1
    }
    if (start < text.length) {
      entry.partialChunks.push(text.slice(start))
      entry.partialLength += text.length - start
    }
  }

  private consumeLine(entry: Entry, line: string): void {
    if (!line.trim()) return
    // Most rollout lines are large tool output or reasoning records with no metadata.
    if (
      !(line.includes('"item_completed"') && line.includes('"started_at_ms"')) &&
      !(line.includes('"response_item"') && line.includes('codex_internal_context')) &&
      !line.includes('"task_started"') &&
      !line.includes('"turn_context"') &&
      !line.includes('"task_complete"') &&
      !line.includes('"turn_aborted"')
    )
      return
    let row: Record<string, unknown> | null
    try {
      row = record(JSON.parse(line))
    } catch (error) {
      // A writer may leave its last JSONL record incomplete while the turn is live.
      if (!isExpectedCodexRolloutJsonError(error))
        console.warn('Unable to parse optional Codex rollout metadata', error)
      return
    }
    const payload = record(row?.payload)
    if (!payload) return
    entry.version++
    if (row?.type === 'event_msg' && payload.type === 'task_started') {
      entry.currentTurnId = typeof payload.turn_id === 'string' ? payload.turn_id : null
    } else if (row?.type === 'turn_context' && typeof payload.turn_id === 'string') {
      entry.currentTurnId = payload.turn_id
    } else if (
      row?.type === 'event_msg' &&
      (payload.type === 'task_complete' || payload.type === 'turn_aborted')
    ) {
      entry.currentTurnId = null
    }
    if (row?.type === 'response_item') {
      const prompt = getCodexGoalPrompt(payload)
      const metadata = record(payload.internal_chat_message_metadata_passthrough)
      const turnId = typeof metadata?.turn_id === 'string' ? metadata.turn_id : entry.currentTurnId
      if (prompt && turnId) {
        entry.prompts.set(turnId, prompt)
      }
    }
    if (row?.type !== 'event_msg' || payload.type !== 'item_completed') return
    const item = record(payload.item)
    if (typeof payload.turn_id !== 'string' || typeof item?.id !== 'string') return
    const startedAt = payload.started_at_ms
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return
    const times = entry.starts.get(payload.turn_id) ?? new Map<string, number>()
    times.set(item.id, Math.min(times.get(item.id) ?? startedAt, startedAt))
    entry.starts.set(payload.turn_id, times)
  }
}

/** Use only when the app server runs on the same host and filesystem. */
export const localTranscriptSource = (
  key: string,
  path: string,
  threadId?: string
): TranscriptSource => ({
  key,
  threadId,
  path,
  stat: async () => {
    const info = await stat(path)
    return { size: info.size, modifiedAtMs: info.mtimeMs, identity: `${info.dev}:${info.ino}` }
  },
  read: async (offset, length) => {
    const file = await open(path, 'r')
    try {
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await file.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await file.close()
    }
  }
})
