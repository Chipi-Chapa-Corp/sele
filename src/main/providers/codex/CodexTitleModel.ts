export type CodexTitleModelCandidate = {
  id: string
  model?: string
  displayName?: string
  description?: string
  hidden?: boolean
  supportedReasoningEfforts?: Array<{ reasoningEffort: string }>
  defaultReasoningEffort?: string
}

export type CodexTitleModelSelection = {
  model: string
  effort: string | null
}

const reasoningEffortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']

const getLowestReasoningEffort = (model: CodexTitleModelCandidate): string | null => {
  const efforts =
    model.supportedReasoningEfforts
      ?.map((option) => option.reasoningEffort.trim())
      .filter(Boolean) ?? []
  if (efforts.length === 0) return model.defaultReasoningEffort?.trim() || null

  return [...efforts].sort((first, second) => {
    const firstRank = reasoningEffortOrder.indexOf(first.toLocaleLowerCase())
    const secondRank = reasoningEffortOrder.indexOf(second.toLocaleLowerCase())
    if (firstRank === -1 && secondRank === -1) return 0
    if (firstRank === -1) return 1
    if (secondRank === -1) return -1
    return firstRank - secondRank
  })[0]
}

const getSimplicityScore = (model: CodexTitleModelCandidate): number => {
  const description = model.description?.toLocaleLowerCase() ?? ''
  const label = `${model.id} ${model.model ?? ''} ${model.displayName ?? ''}`.toLocaleLowerCase()
  let score = 0

  if (/\b(affordable|economical|low[- ]cost)\b/.test(description)) score += 100
  if (/\b(lightweight|smallest|small model)\b/.test(description)) score += 80
  if (/\b(mini|nano)\b/.test(label)) score += 60
  if (/\bfast\b/.test(description)) score += 20
  if (/\b(everyday|general)\b/.test(description)) score += 5
  if (/\b(most capable|complex|demanding|hardest)\b/.test(description)) score -= 20

  return score
}

export const selectCodexTitleModel = (
  models: readonly CodexTitleModelCandidate[]
): CodexTitleModelSelection | null => {
  const available = models.filter((model) => model.id.trim() && !model.hidden)
  if (available.length === 0) return null

  // The catalog is ordered from preferred/more capable to fallback models. Prefer an explicit
  // lightweight/cost signal; otherwise take its final available entry rather than pinning an ID.
  const model = available.reduce((best, candidate) =>
    getSimplicityScore(candidate) >= getSimplicityScore(best) ? candidate : best
  )
  const selected = getSimplicityScore(model) > 0 ? model : available[available.length - 1]

  return {
    model: selected.id.trim(),
    effort: getLowestReasoningEffort(selected)
  }
}
