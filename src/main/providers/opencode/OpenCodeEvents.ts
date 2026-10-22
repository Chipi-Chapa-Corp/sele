import type { OpenCodeMessageWithParts } from './OpenCodeItemRenderers'
import type { Message, Part } from '@opencode-ai/sdk/v2'
import { markTranscriptRecordsChanged } from '../transcriptProjection/recordChanges.ts'

type OpenCodeSessionEvent = {
  type: string
  sessionID: string
  directory: string | null
  properties: Record<string, unknown>
}

/** Apply the stream before publishing idle; HTTP history may still be an older snapshot. */
export const applyOpenCodeMessageEvent = (
  messages: OpenCodeMessageWithParts[],
  type: string,
  properties: Record<string, unknown>
): OpenCodeMessageWithParts[] | null => {
  const info = isRecord(properties.info) ? properties.info : null
  const part = isRecord(properties.part) ? properties.part : null
  const messageId =
    getString(info?.id) ?? getString(part?.messageID) ?? getString(properties.messageID)
  if (!messageId) return null
  const index = messages.findIndex((message) => message.info.id === messageId)
  const previous = messages[index]
  let next: OpenCodeMessageWithParts[]
  if (type === 'message.updated' && info && (info.role === 'user' || info.role === 'assistant')) {
    const message = { info: info as unknown as Message, parts: previous?.parts ?? [] }
    next = [...messages]
    if (index < 0) {
      next.push(message)
      next.sort((a, b) => a.info.id.localeCompare(b.info.id))
    } else next[index] = message
  } else if (type === 'message.removed') {
    next = messages.filter((message) => message.info.id !== messageId)
  } else if (previous) {
    let parts: Part[]
    if (type === 'message.part.updated' && part && getString(part.id)) {
      parts = [...previous.parts]
      const partIndex = parts.findIndex((item) => item.id === part.id)
      if (partIndex < 0) {
        parts.push(part as unknown as Part)
        parts.sort((a, b) => a.id.localeCompare(b.id))
      } else parts[partIndex] = part as unknown as Part
    } else if (type === 'message.part.removed') {
      parts = previous.parts.filter((item) => item.id !== properties.partID)
    } else if (type === 'message.part.delta' && typeof properties.delta === 'string') {
      const partIndex = previous.parts.findIndex((item) => item.id === properties.partID)
      const current = previous.parts[partIndex]
      if (!current || !('text' in current) || properties.field !== 'text') return null
      parts = [...previous.parts]
      parts[partIndex] = { ...current, text: current.text + properties.delta }
    } else return null
    next = [...messages]
    next[index] = { ...previous, parts }
  } else return null
  let unchanged = 0
  while (unchanged < messages.length && messages[unchanged] === next[unchanged]) unchanged++
  markTranscriptRecordsChanged(messages, next, unchanged)
  return next
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
