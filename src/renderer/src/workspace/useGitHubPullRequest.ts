import { useEffect, useState } from 'react'
import type {
  AppContainerTarget,
  AppGitHubPullRequest,
  AppGitHubPullRequestDetail
} from '../../../shared/app'
import type { ProviderReviewComment } from '../../../shared/provider'
import { appApi } from '../appApi'

export function useGitHubPullRequest({
  active,
  cwd,
  container,
  repository
}: {
  active: boolean
  cwd: string | null
  container?: AppContainerTarget | null
  repository: string | null
}) {
  const scope = JSON.stringify([container ?? null, cwd, repository])
  const [selection, setSelection] = useState<{ scope: string; pr: AppGitHubPullRequest } | null>(
    null
  )
  const selected = selection?.scope === scope ? selection.pr : null
  const [drafts, setDrafts] = useState<
    Record<string, { body: string; comments: ProviderReviewComment[]; commitId: string | null }>
  >({})
  const draftKey = JSON.stringify([scope, selected?.number])
  const reviewDraft = drafts[draftKey] ?? { body: '', comments: [], commitId: null }
  const [version, setVersion] = useState(0)
  const key = JSON.stringify([scope, selected?.number, version])
  const [response, setResponse] = useState<{
    key: string
    result: AppGitHubPullRequestDetail | null
    error: string | null
  } | null>(null)

  // Forget selection when its project or repository disappears, including a switch back later.
  useEffect(() => {
    setSelection((current) => (current?.scope === scope ? current : null))
  }, [scope])

  const number = selected?.number
  useEffect(() => {
    if (!active || !cwd || !repository || !number) return
    let current = true
    const load = async () => {
      try {
        const result = await appApi.getGitHubPullRequest({ cwd, container, repository, number })
        if (current) setResponse({ key, result, error: null })
      } catch (error) {
        if (current)
          setResponse({
            key,
            result: null,
            error: error instanceof Error ? error.message : String(error)
          })
      }
    }
    void load()
    return () => {
      current = false
    }
  }, [active, cwd, container, repository, number, key])

  const matches = response?.key === key
  return {
    selected,
    cwd,
    container,
    reviewDraft,
    setReviewDraft: (draft: typeof reviewDraft) =>
      setDrafts((current) => ({ ...current, [draftKey]: draft })),
    result: matches ? response.result : null,
    error: matches ? response.error : null,
    loading: !!selected && (!matches || (!response.result && !response.error)),
    open: (pr: AppGitHubPullRequest) => setSelection({ scope, pr }),
    close: () => {
      setSelection(null)
      setResponse(null)
    },
    refresh: () => setVersion((value) => value + 1)
  }
}

export type GitHubPullRequestDetailState = ReturnType<typeof useGitHubPullRequest>
