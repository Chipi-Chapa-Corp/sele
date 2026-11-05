import { useCallback, useEffect, useRef, useState } from 'react'
import type { ListRange } from 'react-virtuoso'
import type {
  AppContainerTarget,
  AppGitHubPullRequest,
  AppGitHubPullRequestsResult,
  AppGitHubPullRequestState
} from '../../../shared/app'
import { appApi } from '../appApi'
import { useGitHubPullRequest } from './useGitHubPullRequest'

const pageSize = 20
type PullRequestListInfo = Pick<
  AppGitHubPullRequestsResult,
  'repository' | 'totalCount' | 'pageCount'
>

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
  const sourceKey = JSON.stringify([
    container ?? null,
    cwd,
    states,
    debouncedSearch,
    refreshVersion
  ])
  const [source, setSource] = useState(sourceKey)
  const [range, setRange] = useState({ first: 1, last: 1 })
  const visibleRange = useRef({ first: 1, last: 1 })
  const [info, setInfo] = useState<PullRequestListInfo | null>(null)
  const [pages, setPages] = useState(new Map<number, readonly AppGitHubPullRequest[]>())
  const cache = useRef(new Map<number, readonly AppGitHubPullRequest[]>())
  const requests = useRef(new Map<number, Promise<AppGitHubPullRequestsResult>>())
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const matches = source === sourceKey
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryVersion retries missing pages without moving the viewport
  useEffect(() => {
    if (source !== sourceKey) {
      cache.current = new Map()
      requests.current = new Map()
      setSource(sourceKey)
      setRange({ first: 1, last: 1 })
      visibleRange.current = { first: 1, last: 1 }
      setInfo(null)
      setPages(new Map())
      setPending(0)
      setError(null)
      return
    }
    if (!active || !cwd) return
    let current = true
    for (const page of cache.current.keys()) {
      if (page < windowStart || page > windowEnd) cache.current.delete(page)
    }
    setPages(new Map(cache.current))
    const missing = Array.from(
      { length: windowEnd - windowStart + 1 },
      (_, index) => windowStart + index
    ).filter((page) => !cache.current.has(page))
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
          if (data.page !== page) cache.current.clear()
          cache.current.set(data.page, data.pullRequests)
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
    retryVersion
  ])

  const visibleInfo = matches ? info : null
  const detail = useGitHubPullRequest({
    active,
    cwd,
    container,
    repository: visibleInfo?.repository ?? null
  })
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

  return {
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
    refresh: () => setRefreshVersion((value) => value + 1),
    retry: () => setRetryVersion((value) => value + 1)
  }
}

export type GitHubPullRequestsState = ReturnType<typeof useGitHubPullRequests>
