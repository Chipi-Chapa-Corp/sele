import type { SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeTranscriptMessage } from './ClaudeItemRenderers'
import { parsePartialJson } from './partialJson.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getContent = (message: ClaudeTranscriptMessage): Record<string, unknown>[] => {
  if (!isRecord(message.message)) return []
  if (!Array.isArray(message.message.content)) message.message.content = []
  return message.message.content as Record<string, unknown>[]
}

const getStreamKey = (message: { session_id: string; parent_tool_use_id: string | null }): string =>
  `${message.session_id}:${message.parent_tool_use_id ?? 'root'}`

const createPartialMessage = (
  streamMessage: SDKPartialAssistantMessage,
  message: unknown = {}
): ClaudeTranscriptMessage => {
  const messageRecord = isRecord(message) ? message : {}
  const messageId =
    typeof messageRecord.id === 'string' && messageRecord.id
      ? messageRecord.id
      : getStreamKey(streamMessage)
  return {
    type: 'assistant',
    timestamp: new Date().toISOString(),
    uuid: `${messageId}:partial`,
    session_id: streamMessage.session_id,
    message: {
      ...messageRecord,
      role: 'assistant',
      content: Array.isArray(messageRecord.content)
        ? messageRecord.content.map((block) => (isRecord(block) ? { ...block } : block))
        : []
    },
    parent_tool_use_id: streamMessage.parent_tool_use_id
  }
}

export const applyClaudeStreamEvent = (
  partialMessages: Map<string, ClaudeTranscriptMessage>,
  streamMessage: SDKPartialAssistantMessage
): boolean => {
  const event = streamMessage.event
  const streamKey = getStreamKey(streamMessage)
  if (event.type === 'message_start') {
    partialMessages.set(streamKey, createPartialMessage(streamMessage, event.message))
    return true
  }

  if (event.type !== 'content_block_start' && event.type !== 'content_block_delta') return false

  let partial = partialMessages.get(streamKey)
  if (!partial) {
    partial = createPartialMessage(streamMessage)
    partialMessages.set(streamKey, partial)
  }
  const content = getContent(partial)

  if (event.type === 'content_block_start') {
    content[event.index] = { ...event.content_block, startedAtMs: Date.now() }
    return true
  }
  if (event.type !== 'content_block_delta') return false

  const block = content[event.index]
  if (!block) return false
  const delta = event.delta
  if (delta.type === 'text_delta') {
    block.text = `${typeof block.text === 'string' ? block.text : ''}${delta.text}`
    return true
  }
  if (delta.type === 'thinking_delta') {
    block.thinking = `${typeof block.thinking === 'string' ? block.thinking : ''}${delta.thinking}`
    return true
  }
  if (delta.type === 'signature_delta') {
    block.signature = `${typeof block.signature === 'string' ? block.signature : ''}${delta.signature}`
    return true
  }
  if (delta.type === 'input_json_delta') {
    const partialJson = `${typeof block.partial_json === 'string' ? block.partial_json : ''}${delta.partial_json}`
    block.partial_json = partialJson
    // Surface whatever has streamed so far so the tool label and command fill in live.
    const input = parsePartialJson(partialJson)
    if (input !== undefined) block.input = input
    return true
  }
  return false
}

/** The SDK can emit one completed block at a time, so its indexes need not match the stream. */
export const retainClaudeStreamTiming = (
  partialMessages: Map<string, ClaudeTranscriptMessage>,
  message: ClaudeTranscriptMessage
): ClaudeTranscriptMessage => {
  const partial = partialMessages.get(getStreamKey(message))
  if (!partial || !isRecord(message.message) || !Array.isArray(message.message.content))
    return message
  const blocks = getContent(partial)
  return {
    ...message,
    timestamp: partial.timestamp ?? message.timestamp,
    message: {
      ...message.message,
      content: message.message.content.map((block) => {
        if (!isRecord(block)) return block
        const streamed = blocks.findLast(
          (candidate) =>
            candidate &&
            candidate.type === block.type &&
            (block.id == null || candidate.id === block.id) &&
            (block.type !== 'text' || candidate.text === block.text)
        )
        return streamed?.startedAtMs != null
          ? { ...block, startedAtMs: streamed.startedAtMs }
          : block
      })
    }
  }
}

export const clearClaudeStreamMessages = (
  partialMessages: Map<string, ClaudeTranscriptMessage>,
  message: { session_id: string; parent_tool_use_id: string | null }
): void => {
  partialMessages.delete(getStreamKey(message))
}
