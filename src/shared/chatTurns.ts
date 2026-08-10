import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderPendingMessage,
  ProviderWorkingStep
} from './provider'

export type ProviderChatTurn = {
  id: string
  items: ProviderChatItem[]
}

const startsChatTurn = (item: ProviderChatItem): boolean =>
  item.type === 'pendingMessage' || (item.type === 'message' && item.role === 'user')

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
    if (startsChatTurn(item) && turnItems.length > 0) finishTurn()
    turnItems.push(item)
  }
  finishTurn()

  return turns
}

const unloadMessageContent = <TMessage extends ProviderMessage | ProviderPendingMessage>(
  message: TMessage
): TMessage => ({
  ...message,
  content: '',
  attachments: undefined,
  contentLoaded: false
})

export const unloadWorkingStepItems = (step: ProviderWorkingStep): ProviderWorkingStep => ({
  ...step,
  items: [],
  itemsLoaded: false,
  itemCount: step.itemsLoaded === false ? step.itemCount : step.items.length
})

export const unloadChatItemsOutsideTurnRange = (
  items: ProviderChatItem[],
  startIndex: number,
  endIndex: number
): ProviderChatItem[] => {
  const turns = getProviderChatTurns(items)
  const loadedItemIds = new Set(
    turns
      .slice(Math.max(0, startIndex), Math.min(turns.length, endIndex))
      .flatMap((turn) => turn.items.map((item) => item.id))
  )
  let changed = false
  const nextItems = items.map((item) => {
    if (loadedItemIds.has(item.id)) return item
    if (item.type === 'working') {
      if (item.itemsLoaded === false) return item
      changed = true
      return unloadWorkingStepItems(item)
    }
    if (
      (item.type === 'message' || item.type === 'pendingMessage') &&
      item.contentLoaded !== false
    ) {
      changed = true
      return unloadMessageContent(item)
    }

    return item
  })

  return changed ? nextItems : items
}
