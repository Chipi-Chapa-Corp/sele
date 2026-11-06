import { useCallback, useEffect, useRef, useState } from 'react'
import type { ListRange } from 'react-virtuoso'
import type {
  AppContainerTarget,
  AppGitHubPullRequest,
  AppGitHubPullRequestsResult,
  AppGitHubPullRequestState
} from '../../../shared/app'
import { appApi } from '../appApi'
import { useStableProps } from './stableProps'
import { useGitHubPullRequest } from './useGitHubPullRequest'

const pageSize = 20
const cacheLifetime = 30_000
const maxCachedQueries = 8
type PullRequestListInfo = Pick<
  AppGitHubPullRequestsResult,
  'repository' | 'totalCount' | 'pageCount'
>
type QueryCache = {
  scope: string
  info: PullRequestListInfo
  pages: Map<number, readonly AppGitHubPullRequest[]>
  fetchedAt: Map<number, number>
  range: { first: number; last: number }
}

export function useGitHubPullRequests({
  active,
  cwd,
  container
}: {
  active: boolean
  cwd: string | null
  container?: AppContainerTarget | null
}) {
  const [states, setStates] = useState<AppGitHubPullRequestState[]>(['open', 'draft'])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [retryVersion, setRetryVersion] = useState(0)
  const scope = JSON.stringify([container ?? null, cwd])
  const sourceKey = JSON.stringify([container ?? null, cwd, [...states].sort(), debouncedSearch])
  const [source, setSource] = useState(sourceKey)
  const [range, setRange] = useState({ first: 1, last: 1 })
  const visibleRange = useRef({ first: 1, last: 1 })
  const [info, setInfo] = useState<PullRequestListInfo | null>(null)
  const [pages, setPages] = useState(new Map<number, readonly AppGitHubPullRequest[]>())
  const cache = useRef(new Map<number, readonly AppGitHubPullRequest[]>())
  const fetchedAt = useRef(new Map<number, number>())
  const queries = useRef(new Map<string, QueryCache>())
  const requests = useRef(new Map<number, Promise<AppGitHubPullRequestsResult>>())
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const matches = source === sourceKey
  const visibleInfo = matches ? info : null
  const refresh = useCallback(() => {
    fetchedAt.current.clear()
    requests.current = new Map()
    for (const entry of queries.current.values()) {
      if (entry.scope === scope) entry.fetchedAt.clear()
    }
    setRefreshVersion((value) => value + 1)
  }, [scope])
  const detail = useGitHubPullRequest({
    active,
    cwd,
    container,
    repository: visibleInfo?.repository ?? null,
    onUpdated: refresh
  })
  const showingDetail = !!detail.selected
  const pageCount = matches ? (info?.pageCount ?? 1) : 1
  const firstVisible = Math.min(range.first, pageCount)
  const lastVisible = Math.min(range.last, pageCount)
  const windowSize = Math.min(pageCount, Math.max(3, lastVisible - firstVisible + 1))
  const windowStart = Math.max(
    1,
    Math.min(
      pageCount - windowSize + 1,
      Math.floor((firstVisible + lastVisible - windowSize + 1) / 2)
    )
  )
  const windowEnd = windowStart + windowSize - 1

  // biome-ignore lint/correctness/useExhaustiveDependencies: versions trigger revalidation; info/range are snapshotted only when the query changes
  useEffect(() => {
    // Scope and cache reconciliation can wait until this panel is opened.
    // Resetting empty maps for an unseen panel adds blocking startup renders.
    if (!active) return
    if (source !== sourceKey) {
      if (info) {
        queries.current.delete(source)
        queries.current.set(source, {
          scope: JSON.stringify(JSON.parse(source).slice(0, 2)),
          info,
          pages: new Map(cache.current),
          fetchedAt: new Map(fetchedAt.current),
          range: visibleRange.current
        })
        while (queries.current.size > maxCachedQueries)
          queries.current.delete(queries.current.keys().next().value!)
      }
      const saved = queries.current.get(sourceKey)
      queries.current.delete(sourceKey)
      cache.current = new Map(saved?.pages)
      fetchedAt.current = new Map(saved?.fetchedAt)
      requests.current = new Map()
      setSource(sourceKey)
      const restoredRange = saved?.range ?? { first: 1, last: 1 }
      setRange(restoredRange)
      visibleRange.current = restoredRange
      setInfo(saved?.info ?? null)
      setPages(new Map(cache.current))
      setPending(0)
      setError(null)
      return
    }
    if (!active || !cwd || showingDetail) return
    let current = true
    for (const page of cache.current.keys()) {
      if (page < windowStart || page > windowEnd) {
        cache.current.delete(page)
        fetchedAt.current.delete(page)
      }
    }
    setPages(new Map(cache.current))
    const missing = Array.from(
      { length: windowEnd - windowStart + 1 },
      (_, index) => windowStart + index
    ).filter(
      (page) =>
        !cache.current.has(page) || Date.now() - (fetchedAt.current.get(page) ?? 0) >= cacheLifetime
    )
    // Serve the visible page before the neighboring buffer pages.
    const center = (visibleRange.current.first + visibleRange.current.last) / 2
    missing.sort(
      (left, right) => Math.abs(left - center) - Math.abs(right - center) || left - right
    )
    let remaining = missing.length
    setPending(remaining)
    setError(null)

    const worker = async (): Promise<void> => {
      while (current && missing.length) {
        const page = missing.shift()!
        try {
          const pendingRequests = requests.current
          let request = pendingRequests.get(page)
          if (!request) {
            const options = { cwd, container, page, states, search: debouncedSearch }
            request = appApi
              .getGitHubPullRequests(options)
              .finally(() => pendingRequests.delete(page))
            pendingRequests.set(page, request)
          }
          const data = await request
          if (!current) return
          if (data.page !== page) {
            cache.current.clear()
            fetchedAt.current.clear()
          }
          cache.current.set(data.page, data.pullRequests)
          fetchedAt.current.set(data.page, Date.now())
          setPages(new Map(cache.current))
          setInfo({
            repository: data.repository,
            totalCount: data.totalCount,
            pageCount: data.pageCount
          })
        } catch (failure) {
          if (current) setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          if (current) setPending(--remaining)
        }
      }
    }
    void worker()
    if (missing.length) void worker()
    return () => {
      current = false
    }
  }, [
    active,
    cwd,
    container,
    states,
    debouncedSearch,
    source,
    sourceKey,
    windowStart,
    windowEnd,
    retryVersion,
    refreshVersion,
    showingDetail
  ])

  useEffect(() => {
    if (!active || showingDetail) return
    const revalidate = () => setRetryVersion((value) => value + 1)
    window.addEventListener('focus', revalidate)
    const timer = window.setInterval(revalidate, cacheLifetime)
    return () => {
      window.removeEventListener('focus', revalidate)
      window.clearInterval(timer)
    }
  }, [active, showingDetail])
  const totalCount = visibleInfo
    ? Math.min(visibleInfo.totalCount, visibleInfo.pageCount * pageSize)
    : 0
  const setVisibleRange = useCallback(({ startIndex, endIndex }: ListRange) => {
    const first = Math.floor(startIndex / pageSize) + 1
    const last = Math.floor(endIndex / pageSize) + 1
    visibleRange.current = { first, last }
    setRange((previous) =>
      previous.first === first && previous.last === last ? previous : { first, last }
    )
  }, [])
  const getPullRequest = useCallback(
    (index: number): AppGitHubPullRequest | undefined =>
      matches ? pages.get(Math.floor(index / pageSize) + 1)?.[index % pageSize] : undefined,
    [matches, pages]
  )

  return useStableProps({
    detail,
    states,
    toggleState: (state: AppGitHubPullRequestState) =>
      setStates((current) =>
        current.includes(state) ? current.filter((value) => value !== state) : [...current, state]
      ),
    search,
    setSearch,
    listKey: sourceKey,
    result: visibleInfo,
    totalCount,
    getPullRequest,
    setVisibleRange,
    loading: !matches || (!visibleInfo && pending > 0),
    loadingRows: matches && pending > 0 && visibleInfo !== null,
    error: matches ? error : null,
    refresh,
    retry: () => setRetryVersion((value) => value + 1)
  })
}

export type GitHubPullRequestsState = ReturnType<typeof useGitHubPullRequests>
