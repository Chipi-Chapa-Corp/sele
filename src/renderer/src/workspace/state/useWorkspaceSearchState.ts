import { useCallback, useRef, useState } from 'react'
import { clearChatSearchHighlights } from '../../chatSearch'

export function useWorkspaceSearchState() {
  const [searchOpen, setSearchOpen] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')

  const [chatSearchOpen, setChatSearchOpen] = useState(false)

  const [chatSearchQuery, setChatSearchQuery] = useState('')

  const [chatSearchMatchCount, setChatSearchMatchCount] = useState(0)

  const [chatSearchActiveIndex, setChatSearchActiveIndex] = useState(0)

  const chatSearchContentRef = useRef<HTMLDivElement>(null)

  const chatSearchInputRef = useRef<HTMLInputElement>(null)

  const chatSearchMatchesRef = useRef<Range[]>([])

  const chatSearchActiveIndexRef = useRef(0)

  const chatSearchReturnFocusRef = useRef<HTMLElement | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  const resetChatSearch = useCallback((): void => {
    setChatSearchOpen(false)
    setChatSearchQuery('')
    setChatSearchMatchCount(0)
    setChatSearchActiveIndex(0)
    chatSearchMatchesRef.current = []
    chatSearchActiveIndexRef.current = 0
    chatSearchReturnFocusRef.current = null
    clearChatSearchHighlights()
  }, [])
  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    chatSearchOpen,
    setChatSearchOpen,
    chatSearchQuery,
    setChatSearchQuery,
    chatSearchMatchCount,
    setChatSearchMatchCount,
    chatSearchActiveIndex,
    setChatSearchActiveIndex,
    chatSearchContentRef,
    chatSearchInputRef,
    chatSearchMatchesRef,
    chatSearchActiveIndexRef,
    chatSearchReturnFocusRef,
    searchInputRef,
    resetChatSearch
  }
}
