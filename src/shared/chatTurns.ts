import type { ProviderChatItem, ProviderWorkingStep } from './provider'

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

export const unloadWorkingStepItems = (step: ProviderWorkingStep): ProviderWorkingStep => {
  const stepWithoutSegments = { ...step }
  delete stepWithoutSegments.itemSegments
  return {
    ...stepWithoutSegments,
    items: [],
    itemsLoaded: false,
    itemCount:
      step.itemsLoaded === false
        ? step.itemCount
        : Math.max(step.itemCount ?? 0, step.items.length),
    itemsStartIndex: 0
  }
}
