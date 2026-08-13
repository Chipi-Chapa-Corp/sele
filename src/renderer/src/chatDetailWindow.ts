import type {
  ProviderChatDetail,
  ProviderChatItem,
  ProviderChatTurnPage
} from '../../shared/provider'
import { getProviderChatTurns } from '../../shared/chatTurns.ts'
import type { ChatTurnWindow } from './chatTurnWindow'

export const getChatDetailTurnCount = (detail: ProviderChatDetail | null | undefined): number =>
  detail?.turnCount ?? getProviderChatTurns(detail?.items ?? []).length

export const getChatDetailItemsStartTurnIndex = (
  detail: ProviderChatDetail | null | undefined
): number => detail?.itemsStartTurnIndex ?? 0

export const getLoadedChatDetailTurnEndIndex = (
  detail: ProviderChatDetail | null | undefined
): number =>
  getChatDetailItemsStartTurnIndex(detail) + getProviderChatTurns(detail?.items ?? []).length

export const mergeChatDetailTurnPage = (
  detail: ProviderChatDetail,
  page: ProviderChatTurnPage,
  retainedWindow: Pick<ChatTurnWindow, 'startIndex' | 'endIndex' | 'totalCount'>
): ProviderChatDetail => {
  const turnsByIndex = new Map<number, ProviderChatItem[]>()
  const currentStartIndex = getChatDetailItemsStartTurnIndex(detail)
  getProviderChatTurns(detail.items).forEach((turn, index) => {
    turnsByIndex.set(currentStartIndex + index, turn.items)
  })
  getProviderChatTurns(page.items).forEach((turn, index) => {
    turnsByIndex.set(page.startIndex + index, turn.items)
  })

  const items: ProviderChatItem[] = []
  for (
    let turnIndex = retainedWindow.startIndex;
    turnIndex < retainedWindow.endIndex;
    turnIndex += 1
  ) {
    const turnItems = turnsByIndex.get(turnIndex)
    if (turnItems) items.push(...turnItems)
  }

  return {
    ...detail,
    items,
    itemsStartTurnIndex: retainedWindow.startIndex,
    turnCount: Math.max(detail.turnCount ?? 0, page.totalCount, retainedWindow.totalCount)
  }
}

export const retainLoadedChatDetailTurnWindow = (
  detail: ProviderChatDetail,
  retainedWindow: Pick<ChatTurnWindow, 'startIndex' | 'endIndex' | 'totalCount'>
): ProviderChatDetail =>
  mergeChatDetailTurnPage(
    detail,
    {
      items: [],
      startIndex: retainedWindow.startIndex,
      totalCount: retainedWindow.totalCount
    },
    retainedWindow
  )
