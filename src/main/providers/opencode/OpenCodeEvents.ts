import type { OpenCodeMessageWithParts } from './OpenCodeItemRenderers'
import type { Message, Part } from '@opencode-ai/sdk/v2'
import { markTranscriptRecordsChanged } from '../transcriptProjection/recordChanges.ts'

type OpenCodeSessionEvent = {
  type: string
  sessionID: string
  directory: string | null
  properties: Record<string, unknown>
}

const updateMessage = (
  previous: OpenCodeMessageWithParts | undefined,
  type: string,
  properties: Record<string, unknown>
): OpenCodeMessageWithParts | null | undefined => {
  const info = isRecord(properties.info) ? properties.info : null
  const part = isRecord(properties.part) ? properties.part : null
  if (type === 'message.updated' && info && (info.role === 'user' || info.role === 'assistant'))
    return { info: info as unknown as Message, parts: previous?.parts ?? [] }
  if (type === 'message.removed') return null
  if (!previous) return undefined
  let parts: Part[]
  if (type === 'message.part.updated' && part && getString(part.id)) {
    parts = [...previous.parts]
    const index = parts.findIndex((item) => item.id === part.id)
    if (index < 0) {
      parts.push(part as unknown as Part)
      parts.sort((a, b) => a.id.localeCompare(b.id))
    } else parts[index] = part as unknown as Part
  } else if (type === 'message.part.removed') {
    parts = previous.parts.filter((item) => item.id !== properties.partID)
  } else if (type === 'message.part.delta' && typeof properties.delta === 'string') {
    const index = previous.parts.findIndex((item) => item.id === properties.partID)
    const current = previous.parts[index]
    if (!current || !('text' in current) || properties.field !== 'text') return undefined
    parts = [...previous.parts]
    parts[index] = { ...current, text: current.text + properties.delta }
  } else return undefined
  return { ...previous, parts }
}

const getEventMessageId = (properties: Record<string, unknown>): string | null => {
  const info = isRecord(properties.info) ? properties.info : null
  const part = isRecord(properties.part) ? properties.part : null
  return getString(info?.id) ?? getString(part?.messageID) ?? getString(properties.messageID)
}

/** Apply the stream before publishing idle; HTTP history may still be an older snapshot. */
export const applyOpenCodeMessageEvent = (
  messages: OpenCodeMessageWithParts[],
  type: string,
  properties: Record<string, unknown>
): OpenCodeMessageWithParts[] | null => {
  const messageId = getEventMessageId(properties)
  if (!messageId) return null
  const index = messages.findIndex((message) => message.info.id === messageId)
  const message = updateMessage(messages[index], type, properties)
  if (message === undefined) return null
  let next: OpenCodeMessageWithParts[]
  if (message === null) next = messages.filter((message) => message.info.id !== messageId)
  else {
    next = [...messages]
    if (index < 0) {
      next.push(message)
      next.sort((a, b) => a.info.id.localeCompare(b.info.id))
    } else next[index] = message
  }
  let unchanged = 0
  while (unchanged < messages.length && messages[unchanged] === next[unchanged]) unchanged++
  markTranscriptRecordsChanged(messages, next, unchanged)
  return next
}

/** Owns an unpublished working array; readers receive immutable snapshots. */
export class OpenCodeMessageStore {
  private records: OpenCodeMessageWithParts[]
  private readonly indexes = new Map<string, number>()
  private published: OpenCodeMessageWithParts[] | null = null
  private changedFrom = 0
  private ordered = true

  constructor(records: OpenCodeMessageWithParts[] = []) {
    this.records = records
    this.replace(records)
  }

  replace(records: OpenCodeMessageWithParts[]): void {
    this.records = records
    this.published = null
    this.indexes.clear()
    this.ordered = true
    records.forEach((record, index) => {
      this.indexes.set(record.info.id, index)
      if (index > 0 && records[index - 1].info.id.localeCompare(record.info.id) > 0)
        this.ordered = false
    })
  }

  apply(type: string, properties: Record<string, unknown>): boolean {
    const id = getEventMessageId(properties)
    if (!id) return false
    const index = this.indexes.get(id)
    const message = updateMessage(
      index === undefined ? undefined : this.records[index],
      type,
      properties
    )
    if (message === undefined) return false
    if (message === null && index === undefined) return true
    if (!this.published) {
      this.published = this.records
      this.records = this.records.slice()
      this.changedFrom = this.records.length
    }
    this.changedFrom = Math.min(this.changedFrom, index ?? this.records.length)
    if (message === null) {
      this.records.splice(index!, 1)
      this.indexes.delete(id)
      for (let offset = index!; offset < this.records.length; offset++)
        this.indexes.set(this.records[offset].info.id, offset)
    } else if (index !== undefined) this.records[index] = message
    else {
      const last = this.records.at(-1)
      this.indexes.set(id, this.records.length)
      this.records.push(message)
      if (!this.ordered || (last && last.info.id.localeCompare(id) > 0)) {
        this.records.sort((a, b) => a.info.id.localeCompare(b.info.id))
        this.records.forEach((record, offset) => this.indexes.set(record.info.id, offset))
        this.changedFrom = 0
        this.ordered = true
      }
    }
    return true
  }

  snapshot(): OpenCodeMessageWithParts[] {
    if (this.published) {
      markTranscriptRecordsChanged(this.published, this.records, this.changedFrom)
      this.published = null
    }
    return this.records
  }
}

const messageStores = new WeakMap<{ messages: OpenCodeMessageWithParts[] }, OpenCodeMessageStore>()

/** A state read publishes the batch, including reads for HTTP reconciliation and completion. */
export const queueOpenCodeMessageEvent = (
  state: { messages: OpenCodeMessageWithParts[] },
  type: string,
  properties: Record<string, unknown>
): boolean => {
  let store = messageStores.get(state)
  if (!store) {
    const bound = new OpenCodeMessageStore(state.messages)
    Object.defineProperty(state, 'messages', {
      enumerable: true,
      configurable: true,
      get: () => bound.snapshot(),
      set: (messages: OpenCodeMessageWithParts[]) => bound.replace(messages)
    })
    messageStores.set(state, bound)
    store = bound
  }
  return store.apply(type, properties)
}

/** Already-buffered SSE events must share the main loop with IPC and publication timers. */
export const forEachOpenCodeEvent = async (
  stream: AsyncIterable<unknown>,
  signal: AbortSignal,
  visit: (event: unknown) => void
): Promise<void> => {
  let yieldAt = performance.now() + 8
  for await (const event of stream) {
    if (signal.aborted) return
    visit(event)
    if (performance.now() >= yieldAt) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      yieldAt = performance.now() + 8
    }
  }
}

/** Keep events received during a history request, including additions and removals. */
export const reconcileOpenCodeMessageSnapshot = (
  before: OpenCodeMessageWithParts[],
  current: OpenCodeMessageWithParts[],
  snapshot: OpenCodeMessageWithParts[]
): OpenCodeMessageWithParts[] => {
  if (before === current) return snapshot
  const initial = new Map(before.map((message) => [message.info.id, message]))
  const live = new Map(current.map((message) => [message.info.id, message]))
  const next = snapshot.flatMap((message) => {
    const id = message.info.id
    const updated = live.get(id)
    if (initial.has(id) && !updated) return []
    return [updated && updated !== initial.get(id) ? updated : message]
  })
  const ids = new Set(next.map((message) => message.info.id))
  next.push(
    ...current.filter(
      (message) => !ids.has(message.info.id) && message !== initial.get(message.info.id)
    )
  )
  next.sort((a, b) => a.info.id.localeCompare(b.info.id))
  return next
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

export const parseOpenCodeSessionEvent = (globalEvent: unknown): OpenCodeSessionEvent | null => {
  if (!isRecord(globalEvent) || !isRecord(globalEvent.payload)) return null
  const type = getString(globalEvent.payload.type)
  const properties = isRecord(globalEvent.payload.properties)
    ? globalEvent.payload.properties
    : isRecord(globalEvent.payload.data)
      ? globalEvent.payload.data
      : null
  if (!type || !properties) return null

  // The event ID and a generic `properties.id` identify the event or its
  // resource. Only `sessionID` is safe to pass to OpenCode's session API.
  const sessionID = getString(properties.sessionID)
  if (!sessionID) return null

  return {
    type,
    sessionID,
    directory: getString(globalEvent.directory),
    properties
  }
}
