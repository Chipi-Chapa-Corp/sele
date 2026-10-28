import type {
  ProviderChatContextUsage,
  ProviderTokenUsageBreakdown
} from '../../../shared/provider'
import { getUnchangedTranscriptPrefix } from '../transcriptProjection/recordChanges.ts'
import type { OpenCodeMessageWithParts } from './OpenCodeItemRenderers'

const empty = (): ProviderTokenUsageBreakdown => ({
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0
})

const breakdown = (message: OpenCodeMessageWithParts): ProviderTokenUsageBreakdown => {
  if (message.info.role !== 'assistant') return empty()
  const tokens = message.info.tokens
  return {
    totalTokens: tokens.input + tokens.output + tokens.reasoning + tokens.cache.read,
    inputTokens: tokens.input,
    cachedInputTokens: tokens.cache.read,
    outputTokens: tokens.output,
    reasoningOutputTokens: tokens.reasoning
  }
}

type MessageState = { messages: OpenCodeMessageWithParts[] }
const usageByState = new WeakMap<
  MessageState,
  {
    records: OpenCodeMessageWithParts[]
    total: ProviderTokenUsageBreakdown
  }
>()

/** Only the changed native suffix contributes new work after the first read. */
export const getOpenCodeContextUsage = (
  state: MessageState,
  modelContextLimits: ReadonlyMap<string, number>
): ProviderChatContextUsage | null => {
  const records = state.messages
  let cached = usageByState.get(state)
  if (cached?.records !== records) {
    const prefix = cached ? getUnchangedTranscriptPrefix(cached.records, records) : 0
    const total = prefix && cached ? { ...cached.total } : empty()
    const add = (message: OpenCodeMessageWithParts, direction: number): void => {
      const value = breakdown(message)
      total.totalTokens += direction * value.totalTokens
      total.inputTokens += direction * value.inputTokens
      total.cachedInputTokens += direction * value.cachedInputTokens
      total.outputTokens += direction * value.outputTokens
      total.reasoningOutputTokens += direction * value.reasoningOutputTokens
    }
    if (prefix && cached)
      for (let index = prefix; index < cached.records.length; index++)
        add(cached.records[index], -1)
    for (let index = prefix; index < records.length; index++) add(records[index], 1)
    cached = { records, total }
    usageByState.set(state, cached)
  }
  const message = records.findLast((message) => message.info.role === 'assistant')
  if (!message || message.info.role !== 'assistant') return null
  const last = breakdown(message)
  return {
    usedTokens: last.totalTokens,
    maxTokens: modelContextLimits.get(`${message.info.providerID}/${message.info.modelID}`) ?? null,
    total: cached.total,
    last,
    updatedAt: message.info.time.completed ?? message.info.time.created
  }
}
