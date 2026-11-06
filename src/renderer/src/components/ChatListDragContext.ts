import { createContext, type Dispatch, type SetStateAction } from 'react'

export const ChatListDragContext = createContext<{
  key: string | null
  setKey: Dispatch<SetStateAction<string | null>>
  index: number | null
  setIndex: Dispatch<SetStateAction<number | null>>
} | null>(null)
