import type {
  ProviderChatDetail,
  ProviderChatItem,
  ProviderChatTurnPage
} from '../../shared/provider'
import { assertUniqueProviderChatItemIds } from '../../shared/chatTurns.ts'

export type ChatCursorWindow = {
  chatKey: string
  items: ProviderChatItem[]
  pages: ProviderChatTurnPage[]
}

/** Retain complete pages so each outer cursor still describes the visible history boundary. */
export const extendChatCursorWindow = (
  current: ChatCursorWindow | null,
  chatKey: string,
  detail: ProviderChatDetail,
  page: ProviderChatTurnPage,
  direction: 'older' | 'newer'
): ChatCursorWindow => {
  // Streaming can replace item payloads without changing the page boundaries.
  const starts =
    current?.chatKey === chatKey
      ? current.pages.map((part) => detail.items.findIndex((item) => item.id === part.items[0]?.id))
      : []
  const pages =
    starts[0] === 0 && starts.every((start, index) => index === 0 || start > starts[index - 1])
      ? current!.pages.map((part, index) => ({
          ...part,
          items: detail.items.slice(starts[index], starts[index + 1])
        }))
      : [
          {
            items: detail.items,
            subagents: detail.subagents,
            startIndex: 0,
            totalCount: detail.turnCount ?? 0,
            turnPagination: detail.turnPagination
          }
        ]
  const retained = direction === 'older' ? [page, ...pages].slice(0, 2) : [...pages, page].slice(-2)
  const items = retained.flatMap((part) => part.items)
  assertUniqueProviderChatItemIds(items)
  return { chatKey, items, pages: retained }
}
