import { getTokenCost, type TokenUsage } from '../../shared/tokenUsage.ts'

const costKeys = ['input', 'cachedInput', 'output', 'total'] as const

/** Removable sums preserve unknown costs and fallback labels, including after replacements. */
export class TokenUsageAccumulator {
  count = 0
  private input = 0
  private cachedInput = 0
  private output = 0
  private priced = 0
  private fallback = 0
  private costs = [0, 0, 0, 0]
  private unknown = [0, 0, 0, 0]

  add(usage: TokenUsage, direction = 1): void {
    this.count += direction
    this.input += direction * usage.inputTokens
    this.cachedInput += direction * usage.cachedInputTokens
    this.output += direction * usage.outputTokens
    if (usage.cost) this.priced += direction
    if (usage.costUsesFallback) this.fallback += direction
    const cost = getTokenCost(usage)
    costKeys.forEach((key, index) => {
      if (cost[key] == null) this.unknown[index] += direction
      else this.costs[index] += direction * cost[key]
    })
  }

  snapshot(): TokenUsage | null {
    if (!this.count) return null
    return {
      inputTokens: this.input,
      cachedInputTokens: this.cachedInput,
      outputTokens: this.output,
      ...(this.fallback > 0 ? { costUsesFallback: true } : {}),
      ...(this.priced > 0
        ? {
            cost: Object.fromEntries(
              costKeys.map((key, index) => [
                key,
                this.unknown[index] > 0 ? null : Math.max(0, this.costs[index])
              ])
            ) as NonNullable<TokenUsage['cost']>
          }
        : {})
    }
  }
}
