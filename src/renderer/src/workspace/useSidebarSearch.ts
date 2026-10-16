import { useEffect, useRef, useState } from 'react'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderChat } from '../../../shared/provider'
import { providerApi } from '../providerApi'

type SearchState = {
  key: string
  chats: ProviderChat[]
  cursors: (string | null)[]
  loading: boolean
  error: string | null
}

/** Keep search pages separate from the normal sidebar cache and its metadata refreshes. */
export function useSidebarSearch(
  query: string,
  sources: (AppContainerTarget | null)[],
  enabled: boolean
) {
  const searchTerm = query.trim()
  const sourceKey = JSON.stringify(sources)
  const key = enabled && searchTerm ? JSON.stringify([searchTerm, sourceKey]) : ''
  const [state, setState] = useState<SearchState | null>(null)
  const epochRef = useRef(0)
  const loadMoreRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    const epoch = ++epochRef.current
    if (!key) return
    const containers = JSON.parse(sourceKey) as (AppContainerTarget | null)[]
    let current: SearchState = { key, chats: [], cursors: [], loading: true, error: null }
    let loading = false
    const load = async (firstPage: boolean): Promise<void> => {
      if (loading || epochRef.current !== epoch) return
      loading = true
      current = { ...current, loading: true }
      setState(current)
      const pages = await Promise.allSettled(
        containers.map((container, index) =>
          !firstPage && !current.cursors[index]
            ? Promise.resolve(null)
            : providerApi.getChats('codex', {
                container,
                searchTerm,
                cursor: firstPage ? null : current.cursors[index],
                limit: 50
              })
        )
      )
      if (epochRef.current !== epoch) return
      const chats = new Map(current.chats.map((chat) => [chat.id, chat]))
      const cursors = [...current.cursors]
      let failed = false
      pages.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error('Unable to search Codex conversations.', result.reason)
          failed = true
          cursors[index] = null
        } else if (result.value) {
          result.value.chats.forEach((chat) => chats.set(chat.id, chat))
          cursors[index] = result.value.nextCursor
        }
      })
      current = {
        key,
        chats: [...chats.values()],
        cursors,
        loading: false,
        error: failed
          ? 'Codex search unavailable for some sources. Title and folder matches are shown.'
          : current.error
      }
      loading = false
      setState(current)
    }
    loadMoreRef.current = () => load(false)
    const timeout = window.setTimeout(() => void load(true), 200)
    return () => {
      ++epochRef.current
      window.clearTimeout(timeout)
    }
  }, [key, sourceKey, searchTerm])

  const current = state?.key === key ? state : null
  return {
    chats: key ? (current?.chats ?? []) : [],
    loading: Boolean(key && sources.length && (!current || current.loading)),
    error: key ? (current?.error ?? null) : null,
    hasMore: Boolean(key && current?.cursors.some(Boolean)),
    loadMore: () => loadMoreRef.current()
  }
}
