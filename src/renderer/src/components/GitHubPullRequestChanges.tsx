import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppGitHubPullRequestChanges } from '../../../shared/app'
import type { ProviderReviewComment } from '../../../shared/provider'
import type { GitHubPullRequestDetailState } from '../workspace/useGitHubPullRequest'
import { useLatestHandler } from '../workspace/stableProps'
import { appApi } from '../appApi'
import { buildChangeTree } from '../changeTree'
import { renderTreeNode } from './ChangeTree'
import { Button } from './Button'
import { Textarea } from './Textarea'
import { ReviewCommentsButton } from './ReviewCommentsButton'
import type { FileEditorTarget } from './FileEditorDialog'
import { ChangesSidebarGitState, GitRefreshIcon } from './AppStatusStates'

const FileEditorDialog = lazy(() =>
  import('./FileEditorDialog').then((module) => ({ default: module.FileEditorDialog }))
)

export function GitHubPullRequestChanges({
  state
}: {
  state: GitHubPullRequestDetailState
}): React.ReactElement {
  const pr = state.result!
  const [changes, setChanges] = useState<AppGitHubPullRequestChanges | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const postingRef = useRef(false)
  const [posted, setPosted] = useState(false)
  const [target, setTarget] = useState<FileEditorTarget | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const draft = state.reviewDraft
  // biome-ignore lint/correctness/useExhaustiveDependencies: version explicitly refreshes the PR snapshot
  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    Promise.resolve()
      .then(() => {
        return appApi.getGitHubPullRequestChanges({
          cwd: state.cwd,
          container: state.container,
          repository: pr.repository,
          number: pr.number
        })
      })
      .then((result) => {
        if (current) {
          setChanges(result)
          setLoading(false)
        }
      })
      .catch((failure) => {
        if (current) {
          setError(failure instanceof Error ? failure.message : String(failure))
          setLoading(false)
        }
      })
    return () => {
      current = false
    }
  }, [state.cwd, state.container, pr.repository, pr.number, version])
  const files = changes?.files ?? []
  const tree = useMemo(() => buildChangeTree(files), [files])
  const targets = useMemo<FileEditorTarget[]>(
    () =>
      files.map((file) => ({
        ...file,
        cwd: state.cwd!,
        container: state.container,
        displayPath: file.path
      })),
    [files, state.cwd, state.container]
  )
  const updateComments = useLatestHandler((comments: ProviderReviewComment[]) => {
    state.setReviewDraft({
      ...draft,
      comments,
      commitId:
        comments.length > 0
          ? draft.comments.length > 0
            ? draft.commitId
            : (changes?.commitId ?? null)
          : null
    })
    setPosted(false)
  })
  const stale = draft.comments.length > 0 && draft.commitId !== changes?.commitId
  const openFile = (path: string, line?: number, endLine?: number) => {
    const next = targets.find((file) => file.path === path)
    if (next && !stale && !posting) setTarget({ ...next, line, endLine })
  }
  const submit = async () => {
    if (!changes || !draft.body.trim() || stale || postingRef.current) return
    postingRef.current = true
    setPosting(true)
    setError(null)
    try {
      await appApi.submitGitHubPullRequestReview({
        cwd: state.cwd,
        container: state.container,
        repository: pr.repository,
        number: pr.number,
        commitId: changes.commitId,
        body: draft.body,
        comments: draft.comments
      })
      state.setReviewDraft({ body: '', comments: [], commitId: null })
      setPosted(true)
      state.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      postingRef.current = false
      setPosting(false)
    }
  }
  return (
    <section className="changes-sidebar__pull-request-files" aria-label="Pull request files">
      <form
        className="changes-sidebar__pull-request-review"
        aria-label="Pull request review"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Textarea
          ref={bodyRef}
          aria-label="Review summary"
          placeholder="Write a review comment…"
          value={draft.body}
          disabled={posting}
          rows={3}
          onChange={(event) => {
            state.setReviewDraft({ ...draft, body: event.target.value })
            setPosted(false)
          }}
        />
        <div className="changes-sidebar__pull-request-review-actions">
          {draft.comments.length > 0 && (
            <ReviewCommentsButton
              comments={draft.comments}
              disabled={posting}
              onOpenFileLink={(path, _displayPath, line, endLine) => openFile(path, line, endLine)}
              onRemove={() => state.setReviewDraft({ ...draft, comments: [], commitId: null })}
            />
          )}
          <Button
            theme="primary"
            size="small"
            label={posting ? 'Posting…' : 'Post review'}
            disabled={loading || !changes || !draft.body.trim() || posting || stale}
            callback={submit}
          />
        </div>
        {posted && <p role="status">Review posted.</p>}
      </form>
      <div className="changes-sidebar__pull-request-file-tree">
        <div className="changes-sidebar__pull-request-review-actions">
          <strong>Files changed{changes ? ` · ${files.length}` : ''}</strong>
          <Button
            theme="transparent"
            size="small"
            icon={<GitRefreshIcon />}
            aria-label="Refresh pull request files"
            disabled={loading || posting}
            callback={() => setVersion((value) => value + 1)}
          />
        </div>
        {loading && <ChangesSidebarGitState active label="Loading pull request files" />}
        {error && (
          <p className="changes-sidebar__git-error-message" role="alert">
            {error}
          </p>
        )}
        {stale && (
          <p role="alert">
            The pull request has new commits. Discard the previous inline comments and review the
            updated files.
          </p>
        )}
        {!loading && changes && (
          <ul className="changes-sidebar__tree" role="tree" aria-label="Pull request changed files">
            {tree.map((node) =>
              renderTreeNode(node, 0, {
                isCollapsed: (path) => !!collapsed[path],
                getChildren: (_path, children) => children,
                onToggleFolder: (path) =>
                  setCollapsed((current) => ({ ...current, [path]: !current[path] })),
                onOpenFile: (file) => openFile(file.path)
              })
            )}
          </ul>
        )}
      </div>
      {target &&
        createPortal(
          <Suspense fallback={null}>
            <FileEditorDialog
              target={target}
              diffTargets={targets}
              initialReviewComments={draft.comments}
              onClose={() => setTarget(null)}
              onSelectTarget={setTarget}
              onReviewCommentsChange={updateComments}
              onContinueReview={(comments) => {
                updateComments(comments)
                setTarget(null)
                bodyRef.current?.focus()
              }}
            />
          </Suspense>,
          document.body
        )}
    </section>
  )
}
