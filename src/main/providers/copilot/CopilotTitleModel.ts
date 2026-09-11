export type CopilotTitleModelCandidate = {
  id: string
  name?: string
  policy?: { state: 'enabled' | 'disabled' | 'unconfigured' }
  billing?: { multiplier?: number }
  supportedReasoningEfforts?: string[]
}

export type CopilotTitleModelSelection = {
  model: string
  reasoningEffort: string | null
}

const reasoningEffortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const getLowestReasoningEffort = (model: CopilotTitleModelCandidate): string | null => {
  const efforts =
    model.supportedReasoningEfforts?.map((effort) => effort.trim()).filter(Boolean) ?? []
  if (efforts.length === 0) return null

  return [...efforts].sort((first, second) => {
    const firstRank = reasoningEffortOrder.indexOf(first.toLocaleLowerCase())
    const secondRank = reasoningEffortOrder.indexOf(second.toLocaleLowerCase())
    if (firstRank === -1 && secondRank === -1) return 0
    if (firstRank === -1) return 1
    if (secondRank === -1) return -1
    return firstRank - secondRank
  })[0]
}

const getCompactModelScore = (model: CopilotTitleModelCandidate): number => {
  const label = `${model.id} ${model.name ?? ''}`.toLocaleLowerCase()
  if (/\b(nano|small|lite)\b/.test(label)) return 3
  if (/\b(mini|flash|haiku)\b/.test(label)) return 2
  return 0
}

export const selectCopilotTitleModel = (
  models: readonly CopilotTitleModelCandidate[]
): CopilotTitleModelSelection | null => {
  const available = models.filter(
    (model) => model.id.trim() && (!model.policy || model.policy.state === 'enabled')
  )
  if (available.length === 0) return null

  const concreteModels = available.filter((model) => model.id.trim().toLocaleLowerCase() !== 'auto')
  const candidates = concreteModels.length > 0 ? concreteModels : available
  const pricedModels = candidates.filter(
    (model) =>
      typeof model.billing?.multiplier === 'number' && Number.isFinite(model.billing.multiplier)
  )

  const selected =
    pricedModels.length > 0
      ? pricedModels.reduce((cheapest, candidate) =>
          candidate.billing!.multiplier! < cheapest.billing!.multiplier! ? candidate : cheapest
        )
      : candidates.reduce((smallest, candidate) =>
          getCompactModelScore(candidate) >= getCompactModelScore(smallest) ? candidate : smallest
        )

  return {
    model: selected.id.trim(),
    reasoningEffort: getLowestReasoningEffort(selected)
  }
}
