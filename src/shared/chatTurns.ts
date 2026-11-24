import type { ProviderChatItem, ProviderStepVisualization, ProviderWorkingStep } from './provider'

export type ProviderChatTurn = {
  id: string
  items: ProviderChatItem[]
}

export const startsProviderChatTurn = (item: ProviderChatItem): boolean =>
  item.startsTurn === true ||
  item.type === 'pendingMessage' ||
  (item.type === 'message' && item.role === 'user')

/** A transcript is an ordered set. Duplicate IDs are a protocol error, never renderable data. */
export const assertUniqueProviderChatItemIds = (items: readonly ProviderChatItem[]): void => {
  const itemIds = new Set<string>()
  for (const item of items) {
    if (itemIds.has(item.id)) {
      throw new Error(`Invalid chat transcript: duplicate item ID ${item.id}`)
    }
    itemIds.add(item.id)
  }
}

export const getProviderChatTurnStartItemIndexes = (items: ProviderChatItem[]): number[] => {
  if (items.length === 0) return []

  const indexes = [0]
  for (let index = 1; index < items.length; index += 1) {
    if (startsProviderChatTurn(items[index])) indexes.push(index)
  }
  return indexes
}

export const getProviderChatTurnCount = (items: ProviderChatItem[]): number =>
  getProviderChatTurnStartItemIndexes(items).length

export const sliceProviderChatTurns = (
  items: ProviderChatItem[],
  startIndex: number,
  endIndex: number
): ProviderChatItem[] => {
  const turnStartItemIndexes = getProviderChatTurnStartItemIndexes(items)
  const boundedStartIndex = Math.max(0, Math.min(startIndex, turnStartItemIndexes.length))
  const boundedEndIndex = Math.max(
    boundedStartIndex,
    Math.min(endIndex, turnStartItemIndexes.length)
  )
  const startItemIndex = turnStartItemIndexes[boundedStartIndex] ?? items.length
  const endItemIndex = turnStartItemIndexes[boundedEndIndex] ?? items.length
  return items.slice(startItemIndex, endItemIndex)
}

export const getProviderChatTurns = (items: ProviderChatItem[]): ProviderChatTurn[] => {
  const turns: ProviderChatTurn[] = []
  let turnItems: ProviderChatItem[] = []

  const finishTurn = (): void => {
    const firstItem = turnItems[0]
    if (!firstItem) return
    turns.push({ id: firstItem.id, items: turnItems })
    turnItems = []
  }

  for (const item of items) {
    if (startsProviderChatTurn(item) && turnItems.length > 0) finishTurn()
    turnItems.push(item)
  }
  finishTurn()

  return turns
}

/** Loaded visualizations, falling back to the summary retained when the items were unloaded. */
export const getWorkingStepVisualizations = (
  step: ProviderWorkingStep
): ProviderStepVisualization[] => {
  if (step.itemsLoaded === false) return step.visualizations ?? []
  const visualizations = step.items.flatMap((item) =>
    item.type === 'message'
      ? []
      : (item.type === 'toolGroup' ? item.tools : [item]).flatMap((tool) =>
          tool.visualization ? [{ id: tool.id, visualization: tool.visualization }] : []
        )
  )
  // A partially loaded page must not drop documents from pages that are not in memory.
  const loadedIds = new Set(visualizations.map(({ id }) => id))
  return [...(step.visualizations ?? []).filter(({ id }) => !loadedIds.has(id)), ...visualizations]
}

export const unloadWorkingStepItems = (step: ProviderWorkingStep): ProviderWorkingStep => {
  const stepWithoutSegments = { ...step }
  delete stepWithoutSegments.itemSegments
  // Use the spread copy: archived steps expose items through a lazily hydrated getter.
  const visualizations = getWorkingStepVisualizations(stepWithoutSegments)
  delete stepWithoutSegments.visualizations
  return {
    ...stepWithoutSegments,
    ...(visualizations.length ? { visualizations } : {}),
    items: [],
    itemsLoaded: false,
    itemCount:
      step.itemsLoaded === false
        ? step.itemCount
        : Math.max(step.itemCount ?? 0, step.items.length),
    itemsStartIndex: 0
  }
}
