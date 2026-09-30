import type { TokenUsage } from '../../shared/tokenUsage.ts'
import { emptyTokenUsage, subtractTokenUsage, tokenUsageEquals } from '../../shared/tokenUsage.ts'
import type { ModelTokenUsage } from './modelPricing/TokenPricing.ts'

/** An idempotent request snapshot, or a cumulative stream with a stable identity. */
export type TokenUsageObservation = {
  chatId: string
  sourceKey: string
  turnId: string | null
  recordId: string
  timestamp: number
  usage: TokenUsage
  models?: ModelTokenUsage[]
  parentChatId?: string | null
  parentTurnId?: string | null
  /** Live request snapshots are superseded by a complete pipeline result for this group. */
  provisionalGroup?: string
  provisionalComplete?: boolean
  replaceProvisionalGroup?: string
  cumulative?: boolean
  /** Initial delta for a stream whose earlier usage belongs to unobserved history. */
  initialUsage?: TokenUsage
}

export type TokenUsageCheckpoint = { usage: TokenUsage; timestamp: number }

export const getTokenUsageIncrement = (
  observation: TokenUsageObservation,
  previous: TokenUsageCheckpoint | undefined
): TokenUsage | null => {
  if (previous && observation.timestamp < previous.timestamp) return null
  if (!previous) return observation.initialUsage ?? observation.usage
  if (tokenUsageEquals(observation.usage, previous.usage)) return emptyTokenUsage()
  const reset =
    observation.usage.inputTokens < previous.usage.inputTokens ||
    observation.usage.cachedInputTokens < previous.usage.cachedInputTokens ||
    observation.usage.outputTokens < previous.usage.outputTokens
  return reset
    ? (observation.initialUsage ?? observation.usage)
    : subtractTokenUsage(observation.usage, previous.usage)
}

/** Adapters publish native accounting independently of transcript/UI update throttling. */
export class TokenUsageReporter {
  private listeners = new Set<(observation: TokenUsageObservation) => void>()
  private snapshots = new Map<string, TokenUsageObservation>()

  subscribe = (listener: (observation: TokenUsageObservation) => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  linkChat(
    chatId: string,
    sourceKey: string,
    parentChatId: string | null | undefined,
    parentTurnId?: string | null
  ): void {
    if (!parentChatId || parentChatId === chatId) return
    this.report({
      chatId,
      sourceKey,
      parentChatId,
      parentTurnId,
      turnId: null,
      recordId: 'lineage',
      timestamp: 0,
      usage: emptyTokenUsage()
    })
  }

  report(observation: TokenUsageObservation): void {
    if (this.listeners.size === 0) return
    if (!observation.cumulative) {
      const key = JSON.stringify([observation.sourceKey, observation.chatId, observation.recordId])
      const previous = this.snapshots.get(key)
      if (
        previous &&
        tokenUsageEquals(previous.usage, observation.usage) &&
        previous.turnId === observation.turnId &&
        previous.parentChatId === observation.parentChatId &&
        previous.parentTurnId === observation.parentTurnId &&
        previous.provisionalComplete === observation.provisionalComplete &&
        JSON.stringify(previous.models) === JSON.stringify(observation.models)
      )
        return
      this.snapshots.delete(key)
      this.snapshots.set(key, observation)
      // Bound memory even when many external histories are explored in one app session.
      if (this.snapshots.size > 20_000) this.snapshots.delete(this.snapshots.keys().next().value!)
    }
    this.listeners.forEach((listener) => listener(observation))
  }
}
