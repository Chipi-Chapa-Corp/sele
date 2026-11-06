import { useEffect, useState } from 'react'
import type {
  AppContainerTarget,
  AppGitHubPullRequest,
  AppGitHubPullRequestDetail,
  AppGitHubPullRequestState
} from '../../../shared/app'
import type { ProviderReviewComment } from '../../../shared/provider'
import { appApi } from '../appApi'
import { useStableProps } from './stableProps'

export function useGitHubPullRequest({
  active,
  cwd,
  container,
  repository,
  onUpdated
}: {
  active: boolean
  cwd: string | null
  container?: AppContainerTarget | null
  repository: string | null
  onUpdated?: () => void
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
  const [commitReview, setCommitReview] = useState<{ key: string; sha: string } | null>(null)
  const reviewDraft = drafts[draftKey] ?? { body: '', comments: [], commitId: null }
  const [version, setVersion] = useState(0)
  const [filesVersion, setFilesVersion] = useState(0)
  const identity = JSON.stringify([scope, selected?.number])
  const key = JSON.stringify([identity, version])
  const [response, setResponse] = useState<{
    identity: string
    key: string
    result: AppGitHubPullRequestDetail | null
    error: string | null
  } | null>(null)

  // Forget selection when its project or repository disappears, including a switch back later.
  useEffect(() => {
    if (!selection || selection.scope === scope) return
    setSelection((current) => (current?.scope === scope ? current : null))
  }, [scope, selection])

  const number = selected?.number
  useEffect(() => {
    if (!active || !cwd || !repository || !number) return
    let current = true
    const load = async () => {
      try {
        const result = await appApi.getGitHubPullRequest({ cwd, container, repository, number })
        if (current) setResponse({ identity, key, result, error: null })
      } catch (error) {
        if (current)
          setResponse((previous) => ({
            identity,
            key,
            result: previous?.identity === identity ? previous.result : null,
            error: error instanceof Error ? error.message : String(error)
          }))
      }
    }
    void load()
    return () => {
      current = false
    }
  }, [active, cwd, container, repository, number, identity, key])

  const matches = response?.key === key
  const result = response?.identity === identity ? response.result : null
  return useStableProps(
    {
      selected,
      cwd,
      container,
      reviewDraft,
      filesVersion,
      reviewCommit: commitReview?.key === draftKey ? commitReview.sha : null,
      openCommit: (sha: string) => setCommitReview({ key: draftKey, sha }),
      closeCommit: () => setCommitReview(null),
      setReviewDraft: (draft: typeof reviewDraft) =>
        setDrafts((current) => ({ ...current, [draftKey]: draft })),
      result,
      error: matches ? response.error : null,
      loading: !!selected && !result && (!matches || !response.error),
      refreshing: !!selected && !!result && !matches,
      open: (pr: AppGitHubPullRequest) => setSelection({ scope, pr }),
      close: () => {
        if (result && selected && result.state !== selected.state) onUpdated?.()
        setSelection(null)
        setResponse(null)
      },
      refreshDiscussion: (nextState?: AppGitHubPullRequestState) => {
        if (nextState) {
          setResponse((previous) =>
            previous?.identity === identity && previous.result
              ? { ...previous, result: { ...previous.result, state: nextState } }
              : previous
          )
        }
        setVersion((value) => value + 1)
        onUpdated?.()
      },
      refresh: () => {
        setVersion((value) => value + 1)
        setFilesVersion((value) => value + 1)
        onUpdated?.()
      }
    },
    { nested: ['reviewDraft'] }
  )
}

export type GitHubPullRequestDetailState = ReturnType<typeof useGitHubPullRequest>
