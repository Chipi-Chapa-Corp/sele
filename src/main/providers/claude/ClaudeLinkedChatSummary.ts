import type { ClaudeTranscriptMessage } from './ClaudeItemRenderers.ts'
import {
  cleanClaudeCompactSummary,
  formatLinkedChatRecentMessages,
  getMessageContentText,
  joinLinkedChatSummary,
  type LinkedChatTranscriptMessage
} from '../linkedChatContext.ts'

const getRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

const getMessageContent = (message: ClaudeTranscriptMessage): unknown =>
  getRecord(message.message)?.content

/** IDs Claude kept verbatim after the summary; it wrote the summary without them. */
const getPreservedMessageIds = (boundary: ClaudeTranscriptMessage | undefined): string[] => {
  const metadata = getRecord(getRecord(boundary?.message)?.compactMetadata)
  const preserved = getRecord(metadata?.preservedMessages)
  const ids = preserved?.uuids ?? preserved?.allUuids
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

const isCompactBoundary = (message: ClaudeTranscriptMessage): boolean =>
  message.type === 'system' && getRecord(message.message)?.subtype === 'compact_boundary'

/**
 * Linked context from a compacted Claude transcript: the newest compact summary plus the
 * recent user/assistant text Claude preserved beside it. Tool records are omitted.
 */
export const getClaudeLinkedChatSummary = (
  messages: readonly ClaudeTranscriptMessage[]
): string | null => {
  const summaryIndex = messages.findLastIndex(
    (message) => message.type === 'user' && message.isCompactSummary === true
  )
  if (summaryIndex < 0) return null
  const summary = cleanClaudeCompactSummary(
    getMessageContentText(getMessageContent(messages[summaryIndex]!))
  )
  const boundary = messages.slice(0, summaryIndex).findLast(isCompactBoundary)
  const preservedIds = new Set(getPreservedMessageIds(boundary))
  const recent = messages.flatMap((message): LinkedChatTranscriptMessage[] => {
    if (!preservedIds.has(message.uuid) || message.isMeta || message.isCompactSummary) return []
    if (message.type !== 'user' && message.type !== 'assistant') return []
    const text = getMessageContentText(getMessageContent(message))
    return text ? [{ role: message.type, text }] : []
  })
  return joinLinkedChatSummary(summary, formatLinkedChatRecentMessages(recent)) || null
}
