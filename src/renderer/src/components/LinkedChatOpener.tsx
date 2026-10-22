import { createContext, useContext } from 'react'
import type { LinkedChatReference } from '../linkedChats'

/** Opens the source of a linked chat chip; absent where chats cannot be navigated. */
export const LinkedChatOpenerContext = createContext<((chat: LinkedChatReference) => void) | null>(
  null
)

export const useLinkedChatOpener = (): ((chat: LinkedChatReference) => void) | null =>
  useContext(LinkedChatOpenerContext)
