import { useState } from 'react'
import { ExternalLink, GitPullRequestArrow, Globe, X } from 'lucide-react'
import type { BrowserOpenRequest } from '../../../shared/browser'
import type { GitHubPullRequestsState } from '../workspace/useGitHubPullRequests'
import { appApi } from '../appApi'
import {
  GitHubPullRequestStateIcon,
  gitHubPullRequestStateLabels
} from './GitHubPullRequestStateIcon'
import { Button } from './Button'
import { ChangesSidebarGitState, GitRefreshIcon } from './AppStatusStates'

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
      className="changes-sidebar__content"
      aria-label="GitHub pull requests"
      aria-busy={loading}
    >
      {(error || linkError) && (
        <section
          className="changes-sidebar__git-error"
          role="alert"
          aria-label="Pull requests error"
        >
          <span className="changes-sidebar__git-error-message">{error || linkError}</span>
          <div className="changes-sidebar__git-error-actions">
            {error && (
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
      {loading ? (
        <ChangesSidebarGitState Icon={GitPullRequestArrow} active label="Loading pull requests" />
      ) : !error && (!result || result.pullRequests.length === 0) ? (
        <ChangesSidebarGitState
          Icon={GitPullRequestArrow}
          active={false}
          label={
            state.states.length
              ? 'No pull requests match the selected states'
              : 'Select a state to see pull requests'
          }
        />
      ) : (
        !error && (
          <ul className="changes-sidebar__recents" aria-label="Pull requests">
            {result?.pullRequests.map((pr) => {
              const label = `#${pr.number} ${pr.title}`
              const title = `${label}${pr.author ? ` · ${pr.author}` : ''} · ${gitHubPullRequestStateLabels[pr.state]}`
              return (
                <li className="changes-sidebar__recent-item" key={pr.number}>
                  <div className="changes-sidebar__recent-row" title={title}>
                    <span className="changes-sidebar__recent-icon" aria-hidden="true">
                      <GitHubPullRequestStateIcon state={pr.state} />
                    </span>
                    <span className="changes-sidebar__recent-label">{label}</span>
                  </div>
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
                </li>
              )
            })}
          </ul>
        )
      )}
    </section>
  )
}
