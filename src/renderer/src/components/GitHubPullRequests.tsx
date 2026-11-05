import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { Virtuoso, type Components, type ItemProps, type ListProps } from 'react-virtuoso'
import { ExternalLink, GitPullRequestArrow, Globe, X } from 'lucide-react'
import type { BrowserOpenRequest } from '../../../shared/browser'
import type { GitHubPullRequestsState } from '../workspace/useGitHubPullRequests'
import { appApi } from '../appApi'
import {
  GitHubPullRequestStateIcon,
  gitHubPullRequestStateLabels
} from './GitHubPullRequestStateIcon'
import { Button } from './Button'
import { AnimatedStatusIcon, ChangesSidebarGitState, GitRefreshIcon } from './AppStatusStates'
import { GitHubPullRequestDetail } from './GitHubPullRequestDetail'

const PullRequestList = forwardRef<
  HTMLUListElement,
  ListProps<HTMLUListElement> & { context?: GitHubPullRequestsState }
>(function PullRequestList({ context: _context, ...props }, ref) {
  return (
    <ul {...props} ref={ref} className="changes-sidebar__virtual-list" aria-label="Pull requests" />
  )
})

function PullRequestItem({
  item: _item,
  context: _context,
  ...props
}: ItemProps<unknown> & { context?: GitHubPullRequestsState }) {
  return <li {...props} className="changes-sidebar__virtual-item" />
}

const virtualComponents: Components<unknown, GitHubPullRequestsState, HTMLUListElement> = {
  List: PullRequestList,
  Item: PullRequestItem
}

type GitHubPullRequestsProps = {
  state: GitHubPullRequestsState
  browserEnabled: boolean
  onOpenBrowser: (request: BrowserOpenRequest) => void
}

export function GitHubPullRequests({
  state,
  browserEnabled,
  onOpenBrowser
}: GitHubPullRequestsProps): React.ReactElement {
  const [linkError, setLinkError] = useState<string | null>(null)
  const listRoot = useRef<HTMLDivElement | null>(null)
  const returnScrollTop = useRef<number | null>(null)
  const listHeight = useRef(0)
  const selected = state.detail.selected
  useLayoutEffect(() => {
    setLinkError(null)
    if (!selected && returnScrollTop.current !== null) {
      const scroller = listRoot.current?.querySelector<HTMLElement>('[data-virtuoso-scroller]')
      if (scroller) scroller.scrollTop = returnScrollTop.current
    }
  }, [selected])
  const { result, loading, error, retry } = state
  const openExternal = async (url: string): Promise<void> => {
    setLinkError(null)
    try {
      await appApi.handleExternalLink({ url, action: 'open' })
    } catch (failure) {
      console.error('Unable to open GitHub pull request externally.', failure)
      setLinkError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <section
      className="changes-sidebar__content changes-sidebar__pull-requests"
      aria-label="GitHub pull requests"
      aria-busy={loading}
    >
      {((error && !selected) || linkError) && (
        <section
          className="changes-sidebar__git-error"
          role="alert"
          aria-label="Pull requests error"
        >
          <span className="changes-sidebar__git-error-message">
            {(!selected && error) || linkError}
          </span>
          <div className="changes-sidebar__git-error-actions">
            {error && !selected && (
              <Button theme="secondary" label="Retry" icon={<GitRefreshIcon />} callback={retry} />
            )}
            {linkError && (
              <Button
                theme="secondary"
                label="Dismiss"
                icon={<X aria-hidden="true" />}
                callback={() => setLinkError(null)}
              />
            )}
          </div>
        </section>
      )}
      <div className="changes-sidebar__content changes-sidebar__pull-request-views">
        <div
          ref={listRoot}
          className="changes-sidebar__content"
          style={
            selected
              ? { visibility: 'hidden', flex: 'none', height: listHeight.current }
              : undefined
          }
          inert={!!selected}
          aria-hidden={!!selected}
        >
          {loading ? (
            <ChangesSidebarGitState
              Icon={GitPullRequestArrow}
              active
              label="Loading pull requests"
            />
          ) : !result || state.totalCount === 0 ? (
            !error && (
              <ChangesSidebarGitState
                Icon={GitPullRequestArrow}
                active={false}
                label={
                  state.search.trim()
                    ? 'No pull requests match your search'
                    : state.states.length
                      ? 'No pull requests match the selected states'
                      : 'Select a state to see pull requests'
                }
              />
            )
          ) : (
            <Virtuoso
              key={state.listKey}
              className="changes-sidebar__pull-request-list"
              style={{ height: '100%' }}
              totalCount={state.totalCount}
              context={state}
              components={virtualComponents}
              computeItemKey={(index) => index}
              rangeChanged={state.setVisibleRange}
              increaseViewportBy={200}
              itemContent={(index) => {
                const pr = state.getPullRequest(index)
                if (!pr)
                  return (
                    <div className="changes-sidebar__recent-item" aria-busy={state.loadingRows}>
                      <div className="changes-sidebar__recent-row">
                        <span className="changes-sidebar__recent-icon" aria-hidden="true">
                          <AnimatedStatusIcon
                            Icon={GitPullRequestArrow}
                            active={state.loadingRows}
                          />
                        </span>
                        <span className="changes-sidebar__recent-label">
                          {state.error ? 'Unable to load pull request' : 'Loading pull request…'}
                        </span>
                      </div>
                    </div>
                  )
                const label = `#${pr.number} ${pr.title}`
                const title = `${label}${pr.author ? ` · ${pr.author}` : ''} · ${gitHubPullRequestStateLabels[pr.state]}`
                return (
                  <div className="changes-sidebar__recent-item">
                    <button
                      type="button"
                      className="changes-sidebar__recent-row"
                      title={title}
                      aria-label={`View pull request #${pr.number}: ${pr.title}`}
                      onClick={(event) => {
                        const scroller = event.currentTarget.closest<HTMLElement>(
                          '[data-virtuoso-scroller]'
                        )
                        returnScrollTop.current = scroller?.scrollTop ?? 0
                        listHeight.current = scroller?.getBoundingClientRect().height ?? 0
                        state.detail.open(pr)
                      }}
                    >
                      <span className="changes-sidebar__recent-icon" aria-hidden="true">
                        <GitHubPullRequestStateIcon state={pr.state} />
                      </span>
                      <span className="changes-sidebar__recent-label">{label}</span>
                    </button>
                    <span className="changes-sidebar__recent-actions">
                      <Button
                        theme="transparent"
                        size="small"
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
                        size="small"
                        icon={<ExternalLink aria-hidden="true" />}
                        aria-label={`Open pull request #${pr.number} in external browser`}
                        title="Open in external browser"
                        callback={() => openExternal(pr.url)}
                      />
                    </span>
                  </div>
                )
              }}
            />
          )}
        </div>
        {selected && (
          <GitHubPullRequestDetail
            key={selected.number}
            state={state.detail}
            browserEnabled={browserEnabled}
            onOpenBrowser={onOpenBrowser}
            onOpenExternal={openExternal}
          />
        )}
      </div>
    </section>
  )
}
