import { normalizeTokenUsage, type TokenUsage } from '../../../shared/tokenUsage.ts'

type LiveRequest = {
  id: string
  turnId: string | null
  timestamp: number
  input: number
  cached: number
  cacheWrite: number
  output: number
  completed: boolean
  modelId?: string
}
const record = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null
const number = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback

/** Assistant-message output usage is a placeholder; stream deltas carry the actual count. */
export class ClaudeLiveTokenUsage {
  private requests = new WeakMap<object, Map<string, LiveRequest>>()

  consume(
    control: object,
    frame: {
      type: string
      event?: unknown
      message?: unknown
      parent_tool_use_id?: string | null
      user_message_uuid?: string
    },
    fallbackTurnId: string | null,
    now = Date.now()
  ): {
    id: string
    turnId: string | null
    timestamp: number
    usage: TokenUsage
    completed: boolean
    modelId?: string
    cacheWriteTokens: number
    contextTokens: number
  } | null {
    let requests = this.requests.get(control)
    if (!requests) {
      requests = new Map()
      this.requests.set(control, requests)
    }
    const scope = frame.parent_tool_use_id ?? 'main'
    const event = record(frame.event)
    const message = frame.type === 'assistant' ? record(frame.message) : record(event?.message)
    let request = requests.get(scope)
    if (message && typeof message.id === 'string') {
      if (!request || request.id !== message.id) {
        request = {
          id: message.id,
          turnId: frame.user_message_uuid ?? fallbackTurnId,
          timestamp: now,
          input: 0,
          cached: 0,
          cacheWrite: 0,
          output: 0,
          completed: false
        }
        requests.set(scope, request)
      }
      if (typeof message.model === 'string') request.modelId = message.model
      if (frame.type === 'assistant') request.completed = true
      const usage = record(message.usage)
      if (usage) {
        request.input = number(usage.input_tokens, request.input)
        request.cached = number(usage.cache_read_input_tokens, request.cached)
        request.cacheWrite = number(usage.cache_creation_input_tokens, request.cacheWrite)
        if (frame.type !== 'assistant') request.output = number(usage.output_tokens, request.output)
      }
    } else if (event?.type === 'message_delta' && request) {
      const usage = record(event.usage)
      if (!usage) return null
      request.input = number(usage.input_tokens, request.input)
      request.cached = number(usage.cache_read_input_tokens, request.cached)
      request.cacheWrite = number(usage.cache_creation_input_tokens, request.cacheWrite)
      request.output = number(usage.output_tokens, request.output)
    } else if (event?.type === 'message_stop' && request) request.completed = true
    else return null
    if (!request) return null
    return {
      id: request.id,
      turnId: request.turnId,
      timestamp: request.timestamp,
      completed: request.completed,
      modelId: request.modelId,
      cacheWriteTokens: request.cacheWrite,
      contextTokens: request.input + request.cached + request.cacheWrite,
      usage: normalizeTokenUsage(request.input + request.cacheWrite, request.cached, request.output)
    }
  }
}
