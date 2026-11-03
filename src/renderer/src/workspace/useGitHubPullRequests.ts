import { useEffect, useState } from 'react'
import type {
  AppContainerTarget,
  AppGitHubPullRequestsResult,
  AppGitHubPullRequestState
} from '../../../shared/app'
import { appApi } from '../appApi'

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
  const sourceKey = JSON.stringify([container ?? null, cwd, states])
  const [source, setSource] = useState(sourceKey)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<AppGitHubPullRequestsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const matches = source === sourceKey

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reloads the current page
  useEffect(() => {
    if (source !== sourceKey) {
      setSource(sourceKey)
      setPage(1)
      setResult(null)
      setLoading(false)
      setError(null)
      return
    }
    if (!active || !cwd) return
    let current = true
    setLoading(true)
    setError(null)
    void appApi.getGitHubPullRequests({ cwd, container, page, states }).then(
      (data) => {
        if (current) {
          setResult(data)
          setPage(data.page)
          setLoading(false)
        }
      },
      (failure: unknown) => {
        if (current) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setLoading(false)
        }
      }
    )
    return () => {
      current = false
    }
  }, [active, cwd, container, page, states, revision, source, sourceKey])

  const pageCount = matches ? (result?.pageCount ?? 1) : 1
  const goToPage = (value: number): void => {
    const next = Number.isFinite(value) ? Math.max(1, Math.min(pageCount, Math.trunc(value))) : 1
    if (next === page) return
    setLoading(true)
    setPage(next)
  }

  return {
    states,
    toggleState: (state: AppGitHubPullRequestState) =>
      setStates((current) =>
        current.includes(state) ? current.filter((value) => value !== state) : [...current, state]
      ),
    result: matches ? result : null,
    loading: loading || !matches,
    error: matches ? error : null,
    page: matches ? page : 1,
    pageCount,
    canGoPrevious: matches && !loading && page > 1,
    canGoNext: matches && !loading && error === null && page < pageCount,
    goToPage,
    previous: () => goToPage(page - 1),
    next: () => goToPage(page + 1),
    refresh: () => setRevision((value) => value + 1),
    retry: () => setRevision((value) => value + 1)
  }
}

export type GitHubPullRequestsState = ReturnType<typeof useGitHubPullRequests>
