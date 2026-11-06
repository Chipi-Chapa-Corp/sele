import { Activity, useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react'
import { indexRetainedChatDom } from '../retainedChatDom'

type View = {
  key: string
  content: ReactElement
  host: RefObject<HTMLDivElement | null>
  retain: boolean
  nodes: number
  turnSizes: Map<HTMLElement, number>
  activated: number
}

const maxViews = 16
const maxNodes = 30_000
// These elements have a lifecycle beyond rendering static conversation content.
// Markdown video thumbnails never play; useMarkdownImages owns their media
// leases and reconnects them with Activity. Keeping one thumbnail must not force
// the entire conversation to remount on every return.

// Cache the mounted tree as well as its data. Activity pauses effects while hidden
// and restores the same nodes and component state when the chat becomes visible.
export function RetainedChatViews({
  activeKey,
  cachedChatKeys,
  retain,
  children
}: {
  activeKey: string | null
  cachedChatKeys: readonly string[]
  retain: boolean
  children: ReactElement | null
}): ReactElement {
  const committed = useRef<{ activeKey: string | null; views: View[] }>({
    activeKey: null,
    views: []
  })
  const indexes = useRef(new Map<string, ReturnType<typeof indexRetainedChatDom>>())
  const allowed = new Set(cachedChatKeys)
  let views = committed.current.views.filter((view) => {
    if (view.key === activeKey) return true
    return view.retain && allowed.has(view.key)
  })
  if (committed.current.activeKey !== activeKey) {
    views = views.flatMap((view) => {
      if (view.key !== committed.current.activeKey) return [view]
      const host = view.host.current
      const indexed = indexes.current.get(view.key)?.read()
      if (
        !host ||
        !indexed ||
        indexed.live ||
        indexed.nodes > maxNodes ||
        host.ownerDocument.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return []
      return [
        {
          ...view,
          nodes: indexed.nodes
        }
      ]
    })
  }
  if (activeKey && children) {
    const existing = views.find((view) => view.key === activeKey)
    const active = {
      key: activeKey,
      content: children,
      host: existing?.host ?? { current: null },
      retain,
      nodes: existing?.nodes ?? 0,
      turnSizes: existing?.turnSizes ?? new Map(),
      activated:
        committed.current.activeKey === activeKey && existing
          ? existing.activated
          : Math.max(0, ...views.map((view) => view.activated)) + 1
    }
    // LRU order must not be DOM order. Moving a retained conversation to the
    // end on every activation re-inserts thousands of already mounted nodes.
    views = existing
      ? views.map((view) => (view.key === activeKey ? active : view))
      : [...views, active]
  }
  let nodes = views.reduce((total, view) => total + (view.key === activeKey ? 0 : view.nodes), 0)
  // A transient loading view must not evict the warm conversation that it is
  // about to reveal. Count retained conversations separately from that shell.
  while (views.filter((view) => view.retain).length > maxViews || nodes > maxNodes) {
    const candidate = views
      .filter((view) => view.retain && view.key !== activeKey)
      .sort((a, b) => a.activated - b.activated)[0]
    const oldest = views.findIndex((view) => view === candidate)
    if (oldest < 0) break
    nodes -= views[oldest].nodes
    views.splice(oldest, 1)
  }
  useLayoutEffect(() => {
    const keys = new Set(views.map((view) => view.key))
    for (const [key, index] of indexes.current) {
      if (keys.has(key)) continue
      index.dispose()
      indexes.current.delete(key)
    }
    for (const view of views) {
      const host = view.host.current
      if (host && !indexes.current.has(view.key))
        indexes.current.set(view.key, indexRetainedChatDom(host))
    }
    // Reusing DOM alone still makes Chromium lay out the entire hidden history
    // when revealed. Keep measured turn sizes so offscreen turns can skip that
    // work until scrolled into view. Apply only after commit, never during render.
    for (const view of views) {
      if (view.key === activeKey) continue
      for (const [node, height] of view.turnSizes) {
        node.style.contentVisibility = 'auto'
        node.style.containIntrinsicBlockSize = `auto ${height}px`
      }
    }
    // Abandoned concurrent renders must not replace the committed cache.
    committed.current = { activeKey, views }
  })
  useLayoutEffect(
    () => () => {
      for (const index of indexes.current.values()) index.dispose()
      indexes.current.clear()
    },
    []
  )
  useLayoutEffect(() => {
    const view = committed.current.views.find((view) => view.key === activeKey)
    const host = view?.host.current
    if (!view || !host) return
    // ResizeObserver supplies sizes from completed layout. Reading every turn's
    // bounds during navigation instead forces offscreen content to lay out and
    // makes even switching to an empty composer wait for the old transcript.
    const sizes = view.turnSizes
    let observed = new Set<HTMLElement>()
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.borderBoxSize[0]?.blockSize
        if (height !== undefined && height > 0) sizes.set(entry.target as HTMLElement, height)
      }
    })
    const syncTurns = (): void => {
      const turns = new Set(host.querySelectorAll<HTMLElement>('[data-chat-turn-id]'))
      for (const node of observed) {
        if (turns.has(node)) continue
        observer.unobserve(node)
        sizes.delete(node)
      }
      for (const node of turns) {
        if (!observed.has(node)) observer.observe(node)
      }
      observed = turns
    }
    syncTurns()
    const mutations = new MutationObserver((records) => {
      // Streaming text/Markdown inside an existing turn cannot add a root turn.
      if (
        records.every(
          ({ target }) => target instanceof Element && target.closest('[data-chat-turn-id]')
        )
      )
        return
      syncTurns()
    })
    mutations.observe(host, { childList: true, subtree: true })
    return () => {
      mutations.disconnect()
      observer.disconnect()
    }
  }, [activeKey])
  return (
    <>
      {views.map((view) => (
        <Activity key={view.key} mode={view.key === activeKey ? 'visible' : 'hidden'}>
          <div ref={view.host} data-chat-view={view.key} style={{ display: 'contents' }}>
            {view.content}
          </div>
        </Activity>
      ))}
    </>
  )
}
