import type { ProviderChatItem, ProviderSubagent } from '../../shared/provider'

export type SubagentMarkerPresentation = {
  label: string
  status: 'pending' | 'finished' | 'failed' | 'stopped'
}

export type SubagentMarkerPlacements = {
  workingStepId: Map<string, ProviderSubagent[]>
  unplaced: ProviderSubagent[]
}

const terminalSubagentStatuses = new Set<ProviderSubagent['status']>([
  'completed',
  'failed',
  'stopped'
])

const getItemCreatedAt = (item: ProviderChatItem): number | null =>
  (item.type === 'message' || item.type === 'pendingMessage') &&
  typeof item.createdAt === 'number' &&
  Number.isFinite(item.createdAt)
    ? item.createdAt
    : null

const getPlacementTime = (subagent: ProviderSubagent): number | null =>
  terminalSubagentStatuses.has(subagent.status) &&
  typeof subagent.updatedAt === 'number' &&
  Number.isFinite(subagent.updatedAt)
    ? subagent.updatedAt
    : null

export const getSubagentMarkerPlacements = (
  subagents: ProviderSubagent[],
  items: ProviderChatItem[]
): SubagentMarkerPlacements => {
  const workingStepId = new Map<string, ProviderSubagent[]>()
  const unplaced: ProviderSubagent[] = []
  const itemIndexById = new Map(items.map((item, index) => [item.id, index]))
  const orderedSubagents = [...subagents].sort((first, second) => {
    const firstTime = getPlacementTime(first) ?? Number.MAX_SAFE_INTEGER
    const secondTime = getPlacementTime(second) ?? Number.MAX_SAFE_INTEGER
    return firstTime - secondTime
  })

  const findPreviousWorkingStep = (startIndex: number): string | null => {
    for (let index = startIndex; index >= 0; index -= 1) {
      const item = items[index]
      if (item.type === 'working') return item.id
      if (item.type === 'pendingMessage' || (item.type === 'message' && item.role === 'user')) break
    }
    return null
  }

  const findNextWorkingStep = (startIndex: number): string | null => {
    for (let index = startIndex; index < items.length; index += 1) {
      const item = items[index]
      if (item.type === 'working') return item.id
      if (
        index > startIndex &&
        (item.type === 'pendingMessage' || (item.type === 'message' && item.role === 'user'))
      ) {
        break
      }
    }
    return null
  }

  const placeInWorkingStep = (subagent: ProviderSubagent, id: string | null): boolean => {
    if (!id) return false
    const markers = workingStepId.get(id) ?? []
    markers.push(subagent)
    workingStepId.set(id, markers)
    return true
  }

  orderedSubagents.forEach((subagent) => {
    if (subagent.afterItemId) {
      const anchorIndex = itemIndexById.get(subagent.afterItemId)
      if (
        anchorIndex === undefined ||
        !placeInWorkingStep(
          subagent,
          findPreviousWorkingStep(anchorIndex - 1) ?? findNextWorkingStep(anchorIndex + 1)
        )
      ) {
        unplaced.push(subagent)
      }
      return
    }

    if (subagent.beforeItemId) {
      const anchorIndex = itemIndexById.get(subagent.beforeItemId)
      if (
        anchorIndex === undefined ||
        !placeInWorkingStep(
          subagent,
          findPreviousWorkingStep(anchorIndex - 1) ?? findNextWorkingStep(anchorIndex)
        )
      ) {
        unplaced.push(subagent)
      }
      return
    }

    const placementTime = getPlacementTime(subagent)
    const nextItemIndex =
      placementTime === null
        ? -1
        : items.findIndex((item) => {
            const createdAt = getItemCreatedAt(item)
            return createdAt !== null && createdAt > placementTime
          })
    const fallbackWorkingStep = items.findLast((item) => item.type === 'working')?.id ?? null
    const targetWorkingStep =
      nextItemIndex >= 0
        ? (findPreviousWorkingStep(nextItemIndex - 1) ?? findNextWorkingStep(nextItemIndex))
        : fallbackWorkingStep
    if (!placeInWorkingStep(subagent, targetWorkingStep)) unplaced.push(subagent)
  })

  return { workingStepId, unplaced }
}

export const getSubagentMarkerPresentation = (
  subagent: ProviderSubagent
): SubagentMarkerPresentation => {
  if (subagent.status === 'pending') {
    return { label: `${subagent.title} is starting…`, status: 'pending' }
  }
  if (subagent.status === 'running') {
    return { label: `${subagent.title} is working…`, status: 'pending' }
  }
  if (subagent.status === 'failed') {
    return { label: `${subagent.title} failed`, status: 'failed' }
  }
  if (subagent.status === 'stopped') {
    return { label: `${subagent.title} stopped`, status: 'stopped' }
  }
  if (subagent.status === 'completed') {
    return { label: `${subagent.title} finished`, status: 'finished' }
  }

  return { label: subagent.title, status: 'finished' }
}
