import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleX, GitMerge, LoaderCircle, Minus } from 'lucide-react'
import type {
  AppGitHubMergeMethod,
  AppGitHubPullRequestChanges,
  AppGitHubPullRequestManagement
} from '../../../shared/app'
import type { ProviderReviewComment } from '../../../shared/provider'
import type { GitHubPullRequestDetailState } from '../workspace/useGitHubPullRequest'
import { useLatestHandler } from '../workspace/stableProps'
import { appApi } from '../appApi'
import { buildChangeTree } from '../changeTree'
import { renderTreeNode } from './ChangeTree'
import { Button } from './Button'
import { Textarea } from './Textarea'
import { ReviewCommentsButton } from './ReviewCommentsButton'
import { GitHubPullRequestStateIcon } from './GitHubPullRequestStateIcon'
import type { FileEditorTarget } from './FileEditorDialog'
import { GitRefreshIcon } from './AppStatusStates'
import './MessageBox.css'

const FileEditorDialog = lazy(() =>
  import('./FileEditorDialog').then((module) => ({ default: module.FileEditorDialog }))
)
const mergeLabels: Record<AppGitHubMergeMethod, string> = {
  merge: 'Create a merge commit',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge'
}
const mergeDescriptions: Record<AppGitHubMergeMethod, string> = {
  merge: 'Add all commits with a merge commit.',
  squash: 'Combine all commits into one commit.',
  rebase: 'Add each commit individually to the base branch.'
}

export function GitHubPullRequestChanges({
  state
}: {
  state: GitHubPullRequestDetailState
}): React.ReactElement {
  const pr = state.result!
  const [changes, setChanges] = useState<AppGitHubPullRequestChanges | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'comment' | 'close' | 'merge' | null>(null)
  const acting = useRef(false)
  const [target, setTarget] = useState<FileEditorTarget | null>(null)
  const [commitSnapshot, setCommitSnapshot] = useState<AppGitHubPullRequestChanges | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [management, setManagement] = useState<AppGitHubPullRequestManagement | null>(null)
  const [managementError, setManagementError] = useState<string | null>(null)
  const [managementVersion, setManagementVersion] = useState(0)
  const [method, setMethod] = useState<AppGitHubMergeMethod | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const emptyRef = useRef<HTMLDialogElement>(null)
  const clearCommit = useLatestHandler(state.closeCommit)
  const draft = state.reviewDraft
  const options = {
    cwd: state.cwd,
    container: state.container,
    repository: pr.repository,
    number: pr.number
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: filesVersion reloads files only on an explicit full refresh
  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    Promise.resolve()
      .then(() =>
        appApi.getGitHubPullRequestChanges({
          cwd: state.cwd,
          container: state.container,
          repository: pr.repository,
          number: pr.number
        })
      )
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
  }, [state.cwd, state.container, pr.repository, pr.number, state.filesVersion])
  // biome-ignore lint/correctness/useExhaustiveDependencies: managementVersion refreshes CI without discarding the comment draft
  useEffect(() => {
    let current = true
    const load = () =>
      Promise.resolve()
        .then(() => {
          if (!appApi.getGitHubPullRequestManagement)
            throw new Error('Restart Sele to load the updated GitHub controls.')
          return appApi.getGitHubPullRequestManagement({
            cwd: state.cwd,
            container: state.container,
            repository: pr.repository,
            number: pr.number
          })
        })
        .then((result) => {
          if (current) {
            setManagement(result)
            setManagementError(null)
          }
        })
        .catch((failure) => {
          if (current)
            setManagementError(failure instanceof Error ? failure.message : String(failure))
        })
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15000)
    const refreshOnFocus = () => {
      if (!acting.current) void load()
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [state.cwd, state.container, pr.repository, pr.number, managementVersion])
  useEffect(() => {
    const sha = state.reviewCommit
    if (!sha) return
    let current = true
    setError(null)
    setTarget(null)
    setCommitSnapshot(null)
    Promise.resolve()
      .then(() => {
        if (!appApi.getGitHubPullRequestCommitChanges)
          throw new Error('Restart Sele to load commit reviews.')
        return appApi.getGitHubPullRequestCommitChanges({
          cwd: state.cwd,
          container: state.container,
          repository: pr.repository,
          number: pr.number,
          commitSha: sha
        })
      })
      .then((snapshot) => {
        if (!current) return
        setCommitSnapshot(snapshot)
        const first = snapshot.files[0]
        setTarget(
          first
            ? { ...first, cwd: state.cwd!, container: state.container, displayPath: first.path }
            : null
        )
      })
      .catch((failure) => {
        if (current) {
          setError(failure instanceof Error ? failure.message : String(failure))
          clearCommit()
        }
      })
    return () => {
      current = false
    }
  }, [clearCommit, state.reviewCommit, state.cwd, state.container, pr.repository, pr.number])
  useEffect(() => {
    if (commitSnapshot?.files.length === 0) emptyRef.current?.showModal()
  }, [commitSnapshot])
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
  const popupTargets = useMemo<FileEditorTarget[]>(
    () =>
      commitSnapshot
        ? commitSnapshot.files.map((file) => ({
            ...file,
            cwd: state.cwd!,
            container: state.container,
            displayPath: file.path
          }))
        : targets,
    [commitSnapshot, targets, state.cwd, state.container]
  )
  const updateComments = useLatestHandler((comments: ProviderReviewComment[]) =>
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
  )
  const stale = draft.comments.length > 0 && draft.commitId !== changes?.commitId
  const openFile = (path: string, line?: number, endLine?: number) => {
    const next = targets.find((file) => file.path === path)
    if (next && !stale && !acting.current) {
      state.closeCommit()
      setCommitSnapshot(null)
      setTarget({ ...next, line, endLine })
    }
  }
  const closePopup = () => {
    setTarget(null)
    setCommitSnapshot(null)
    state.closeCommit()
  }
  const hasComment = !!draft.body.trim() || draft.comments.length > 0
  const selectedMethod =
    method && management?.mergeMethods.includes(method)
      ? method
      : (management?.defaultMergeMethod ?? null)
  const publishComment = async () => {
    if (draft.comments.length) {
      if (!changes || stale) throw new Error('Refresh the files before posting inline comments.')
      await appApi.submitGitHubPullRequestReview({
        ...options,
        commitId: changes.commitId,
        body: draft.body,
        comments: draft.comments
      })
    } else
      await appApi.performGitHubPullRequestAction({
        ...options,
        action: 'comment',
        body: draft.body
      })
    // Clear as soon as posting succeeds; a failed close can then be retried without posting twice.
    state.setReviewDraft({ body: '', comments: [], commitId: null })
  }
  const perform = async (kind: 'comment' | 'close' | 'merge', mergeMethod = selectedMethod) => {
    if (
      acting.current ||
      (kind === 'comment' && !hasComment) ||
      (kind === 'merge' && (!management || !mergeMethod))
    )
      return
    acting.current = true
    setAction(kind)
    setError(null)
    let posted = false
    try {
      if (!appApi.performGitHubPullRequestAction)
        throw new Error('Restart Sele to load the updated GitHub controls.')
      if (kind === 'comment' || (kind === 'close' && hasComment)) {
        await publishComment()
        posted = true
      }
      if (kind === 'close')
        await appApi.performGitHubPullRequestAction({ ...options, action: 'close' })
      if (kind === 'merge')
        await appApi.performGitHubPullRequestAction({
          ...options,
          action: 'merge',
          method: mergeMethod!,
          headSha: management!.headSha
        })
      state.refreshDiscussion(kind === 'merge' ? 'merged' : kind === 'close' ? 'closed' : undefined)
      if (kind !== 'comment') setManagementVersion((value) => value + 1)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      // Posting and closing are separate writes. Keep the error while showing the posted comment.
      if (posted) {
        state.refreshDiscussion()
        setManagementVersion((value) => value + 1)
      }
    } finally {
      acting.current = false
      setAction(null)
    }
  }
  const status = management?.checks
  const statusLabel = !management
    ? 'Loading CI status'
    : status === 'success'
      ? 'All checks passed'
      : status === 'failure'
        ? 'Checks failed'
        : status === 'pending'
          ? 'Checks in progress'
          : 'No checks'
  return (
    <section className="changes-sidebar__pull-request-files" aria-label="Pull request files">
      <div
        className="changes-sidebar__pull-request-ci"
        data-status={managementError ? 'failure' : status}
        role="status"
        aria-label="CI status"
      >
        {managementError ? (
          <>
            <CircleX aria-hidden="true" />
            <span>{managementError}</span>
            <Button
              theme="transparent"
              icon={<GitRefreshIcon />}
              aria-label="Reload CI status"
              callback={() => setManagementVersion((value) => value + 1)}
            />
          </>
        ) : (
          <>
            {!management || status === 'pending' ? (
              <LoaderCircle
                className="chat-detail__messages-status-icon--loading"
                aria-hidden="true"
              />
            ) : status === 'success' ? (
              <Check aria-hidden="true" />
            ) : status === 'failure' ? (
              <CircleX aria-hidden="true" />
            ) : (
              <Minus aria-hidden="true" />
            )}
            <span>
              {statusLabel}
              {management && management.checkCount > 0
                ? ` · ${management.checkCount} ${management.checkCount === 1 ? 'check' : 'checks'}`
                : ''}
            </span>
          </>
        )}
      </div>
      <form
        className="changes-sidebar__pull-request-review"
        aria-label="Pull request comment"
        onSubmit={(event) => {
          event.preventDefault()
          void perform('comment')
        }}
      >
        <Textarea
          ref={bodyRef}
          aria-label="Comment"
          placeholder="Add a comment…"
          value={draft.body}
          disabled={!!action}
          rows={3}
          onChange={(event) => state.setReviewDraft({ ...draft, body: event.target.value })}
        />
        {draft.comments.length > 0 && (
          <ReviewCommentsButton
            comments={draft.comments}
            disabled={!!action}
            onOpenFileLink={(path, _displayPath, line, endLine) => openFile(path, line, endLine)}
            onRemove={() => state.setReviewDraft({ ...draft, comments: [], commitId: null })}
          />
        )}
        <div className="changes-sidebar__pull-request-comment-actions">
          <Button
            theme="secondary"
            icon={<GitMerge aria-hidden="true" />}
            label={selectedMethod ? mergeLabels[selectedMethod] : 'Merge'}
            aria-label="Merge pull request"
            disabled={!!action || !management?.canMerge || !selectedMethod}
            callback={() => perform('merge')}
            dropdownLabel="Merge options"
            dropdownWidth={360}
            dropdownContent={(close) => (
              <div
                className="message-box__chat-config-option-groups changes-sidebar__pull-request-merge-options"
                role="menu"
                aria-label="Merge methods"
              >
                {management?.mergeMethods.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={value === selectedMethod}
                    className={`message-box__chat-config-option message-box__chat-config-option--has-description${value === selectedMethod ? ' message-box__chat-config-option--selected' : ''}`}
                    title={mergeDescriptions[value]}
                    onClick={(event) => {
                      event.stopPropagation()
                      setMethod(value)
                      close()
                    }}
                  >
                    <span className="message-box__chat-config-option-copy">
                      <span className="message-box__chat-config-option-row">
                        <span className="message-box__chat-config-option-label">
                          {mergeLabels[value]}
                        </span>
                        {value === selectedMethod && (
                          <Check className="message-box__chat-config-check" aria-hidden="true" />
                        )}
                      </span>
                      <span className="message-box__chat-config-option-description">
                        {mergeDescriptions[value]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          />
          <div className="changes-sidebar__pull-request-comment-actions-right">
            <Button
              theme="secondary"
              icon={<GitHubPullRequestStateIcon state="closed" />}
              label={
                action === 'close' ? 'Closing…' : hasComment ? 'Close PR with comment' : 'Close PR'
              }
              disabled={!!action || !management?.canClose || stale}
              callback={() => perform('close')}
            />
            <Button
              theme="primary"
              label={action === 'comment' ? 'Posting…' : 'Comment'}
              disabled={!!action || !hasComment || stale}
              callback={() => perform('comment')}
            />
          </div>
        </div>
      </form>
      {error && (
        <p className="changes-sidebar__git-error-message" role="alert">
          {error}
        </p>
      )}
      <div className="changes-sidebar__pull-request-file-tree">
        {loading && (
          <div
            className="changes-sidebar__pull-request-ci"
            role="status"
            aria-label="Loading pull request files"
          >
            <LoaderCircle
              className="chat-detail__messages-status-icon--loading"
              aria-hidden="true"
            />
          </div>
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
              diffTargets={popupTargets}
              initialReviewComments={commitSnapshot ? [] : draft.comments}
              onClose={closePopup}
              onSelectTarget={setTarget}
              onReviewCommentsChange={commitSnapshot ? undefined : updateComments}
              onContinueReview={
                commitSnapshot
                  ? undefined
                  : (comments) => {
                      updateComments(comments)
                      setTarget(null)
                      bodyRef.current?.focus()
                    }
              }
            />
          </Suspense>,
          document.body
        )}
      {commitSnapshot?.files.length === 0 &&
        createPortal(
          <dialog
            ref={emptyRef}
            className="file-editor-confirm"
            aria-label="Commit changes"
            onCancel={(event) => {
              event.preventDefault()
              closePopup()
            }}
          >
            <h2>Commit changes</h2>
            <p>No files changed in this commit.</p>
            <Button label="Close" callback={closePopup} />
          </dialog>,
          document.body
        )}
    </section>
  )
}
