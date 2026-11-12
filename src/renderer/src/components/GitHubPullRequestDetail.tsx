import { Fragment, useEffect, useRef } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Globe
} from 'lucide-react'
import type { AppGitHubPullRequestDetail } from '../../../shared/app'
import type { BrowserOpenRequest } from '../../../shared/browser'
import type { GitHubPullRequestDetailState } from '../workspace/useGitHubPullRequest'
import { formatSemanticLexicalDateDifference, useSemanticDateNow } from '../semanticDateDifference'
import { Button } from './Button'
import { GitHubPullRequestChanges } from './GitHubPullRequestChanges'
import { ChangesSidebarGitState, GitRefreshIcon } from './AppStatusStates'
import { ChatDetailItem } from './ChatDetailItem'
import { GitHubPullRequestStateIcon } from './GitHubPullRequestStateIcon'

type Activity = AppGitHubPullRequestDetail['activity'][number]
const eventLabels: Record<string, string> = {
  merged: 'Merged',
  closed: 'Closed',
  reopened: 'Reopened',
  ready_for_review: 'Marked ready for review',
  convert_to_draft: 'Converted to draft',
  head_ref_force_pushed: 'Force-pushed commits',
  head_ref_deleted: 'Deleted branch',
  head_ref_restored: 'Restored branch',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Requested changes',
  DISMISSED: 'Dismissed review',
  COMMENTED: 'Reviewed'
}
const eventLabel = (item: Activity): string => {
  const action =
    item.state === 'committed'
      ? `Commit ${item.commitSha?.slice(0, 7) ?? ''}`
      : (eventLabels[item.state ?? ''] ?? 'Updated pull request')
  return `${action}${item.author ? ` by ${item.author}` : ''}`
}

export function GitHubPullRequestDetail({
  state,
  browserEnabled,
  onOpenBrowser,
  onOpenExternal
}: {
  state: GitHubPullRequestDetailState
  browserEnabled: boolean
  onOpenBrowser: (request: BrowserOpenRequest) => void
  onOpenExternal: (url: string) => Promise<void>
}): React.ReactElement {
  const heading = useRef<HTMLHeadingElement>(null)
  const number = state.selected?.number
  useEffect(() => {
    if (number) heading.current?.focus()
  }, [number])
  const now = useSemanticDateNow()
  const pr = state.result ?? state.selected!
  const detail = state.result
  const entries: Activity[] = detail
    ? [
        {
          id: 'description',
          author: detail.author,
          body: detail.body || 'No description provided.',
          createdAt: detail.createdAt,
          kind: 'comment',
          state: null
        },
        ...detail.activity
      ]
    : []
  return (
    <section
      className={`changes-sidebar__pull-request-detail${detail && state.cwd ? ' changes-sidebar__pull-request-detail--with-files' : ''}`}
      aria-label={`Pull request #${pr.number} details`}
      aria-busy={state.loading || state.refreshing}
      onClick={(event) => {
        const anchor =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>('a[href]')
            : null
        if (!anchor || event.defaultPrevented) return
        event.preventDefault()
        let url: URL
        try {
          url = new URL(anchor.getAttribute('href')!, pr.url)
        } catch {
          return
        }
        if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) return
        if (browserEnabled && ['https:', 'http:'].includes(url.protocol))
          onOpenBrowser({ id: crypto.randomUUID(), url: url.href })
        else void onOpenExternal(url.href)
      }}
    >
      <header className="chat-detail__message-block changes-sidebar__pull-request-heading">
        <div
          className="changes-sidebar__pull-request-toolbar"
          aria-label="Pull request detail controls"
        >
          <Button
            theme="transparent"
            icon={<ArrowLeft aria-hidden="true" />}
            aria-label="Back to pull requests"
            title="Back to pull requests"
            callback={state.close}
          />
          <span className="changes-sidebar__recent-icon">
            <GitHubPullRequestStateIcon state={pr.state} />
          </span>
          <h3
            ref={heading}
            tabIndex={-1}
            title={`#${pr.number} ${pr.title}${pr.author ? ` · ${pr.author}` : ''}`}
          >
            <span className="changes-sidebar__recent-label">
              #{pr.number} {pr.title}
            </span>
            {pr.author && (
              <span className="changes-sidebar__pull-request-author"> · {pr.author}</span>
            )}
          </h3>
          <Button
            theme="transparent"
            icon={<Globe aria-hidden="true" />}
            aria-label={`Open pull request #${pr.number} in built-in browser`}
            title={
              browserEnabled
                ? 'Open in built-in browser'
                : 'Enable the browser in Settings to open here'
            }
            disabled={!browserEnabled}
            callback={() => onOpenBrowser({ id: crypto.randomUUID(), url: pr.url })}
          />
          <Button
            theme="transparent"
            icon={<ExternalLink aria-hidden="true" />}
            aria-label={`Open pull request #${pr.number} in external browser`}
            title="Open in external browser"
            callback={() => onOpenExternal(pr.url)}
          />
          <Button
            theme="transparent"
            icon={<GitRefreshIcon />}
            aria-label="Refresh pull request"
            title="Refresh pull request"
            disabled={state.loading || state.refreshing}
            callback={state.refresh}
          />
        </div>
        {detail && (
          <div
            className="chat-detail__message-date changes-sidebar__pull-request-refs"
            aria-label="Pull request changes"
          >
            <span className="changes-sidebar__recent-label" title={detail.headRefName}>
              {detail.headRefName}
            </span>
            <ArrowRight aria-label="into" />
            <span className="changes-sidebar__recent-label" title={detail.baseRefName}>
              {detail.baseRefName}
            </span>
            <span>
              · {detail.changedFiles} {detail.changedFiles === 1 ? 'change' : 'changes'} ·{' '}
              <span className="changes-sidebar__pull-request-additions">+{detail.additions}</span>{' '}
              <span className="changes-sidebar__pull-request-deletions">−{detail.deletions}</span>
            </span>
          </div>
        )}
      </header>
      {state.error && (
        <section
          className="changes-sidebar__git-error"
          role="alert"
          aria-label="Pull request details error"
        >
          <span className="changes-sidebar__git-error-message">{state.error}</span>
          <div className="changes-sidebar__git-error-actions">
            <Button
              theme="secondary"
              label="Retry"
              icon={<GitRefreshIcon />}
              callback={state.refresh}
            />
          </div>
        </section>
      )}
      {state.loading ? (
        <ChangesSidebarGitState
          Icon={GitPullRequestArrow}
          active
          label="Loading pull request details"
        />
      ) : (
        detail && (
          <div className="chat-panel chat-panel--selected">
            <div
              className="chat-detail__messages"
              role="region"
              aria-label="Pull request conversation"
            >
              <div className="chat-detail__messages-layout">
                <div className="chat-detail__messages-header" />
                <div className="chat-detail__messages-inner">
                  {entries.map((item) => {
                    const id = `github:${detail.repository}:${detail.number}:${item.id}`
                    const event = (() => {
                      if (item.kind !== 'event' && item.kind !== 'review') return null
                      const date = formatSemanticLexicalDateDifference(Date.parse(item.createdAt), {
                        now
                      })
                      return (
                        <div
                          key={id}
                          className="chat-detail__context-compaction"
                          data-pr-event={item.state}
                          title={[item.kind === 'event' ? item.body : '', date?.title]
                            .filter(Boolean)
                            .join('\n')}
                        >
                          {item.state === 'committed' && item.commitSha ? (
                            <Button
                              theme="secondary"
                              icon={<GitCommitHorizontal aria-hidden="true" />}
                              label={
                                <span className="changes-sidebar__recent-label">
                                  {item.body || item.commitSha.slice(0, 7)}
                                </span>
                              }
                              title={item.body || item.commitSha}
                              aria-label={`Review commit ${item.commitSha.slice(0, 7)}: ${item.body}`}
                              disabled={!state.cwd || state.reviewCommit === item.commitSha}
                              callback={() => state.openCommit(item.commitSha!)}
                            />
                          ) : (
                            <span>{eventLabel(item)}</span>
                          )}
                        </div>
                      )
                    })()
                    const location = item.reviewComment
                    const locationLabel = location
                      ? `${location.path}${location.line ? `:${location.startLine && location.startLine !== location.line ? `${location.startLine}–` : ''}${location.line}` : ''}${location.outdated ? ' (outdated)' : ''}`
                      : null
                    const content =
                      location && locationLabel
                        ? `[${locationLabel.replace(/[\\[\]`*_<>]/g, '\\$&')}](${location.url})\n\n${item.body}`
                        : item.body
                    return (
                      <Fragment key={id}>
                        {event}
                        {item.kind !== 'event' && content.trim() && (
                          <ChatDetailItem
                            key={id}
                            markdownBaseUrl={detail.url}
                            messageBubble
                            item={{
                              type: 'message',
                              id,
                              role:
                                item.author?.toLowerCase() === detail.viewerLogin.toLowerCase()
                                  ? 'user'
                                  : 'assistant',
                              content,
                              createdAt: Date.parse(item.createdAt),
                              label: item.author ?? 'Deleted user'
                            }}
                          />
                        )}
                      </Fragment>
                    )
                  })}
                </div>
                <div className="chat-detail__messages-footer" />
              </div>
            </div>
          </div>
        )
      )}
      {!state.loading && detail && state.cwd && <GitHubPullRequestChanges state={state} />}
    </section>
  )
}
