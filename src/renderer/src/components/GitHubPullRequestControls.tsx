import { useCompactLayout } from '../useCompactLayout'
import { ListFilter, X } from 'lucide-react'
import { appGitHubPullRequestStates } from '../../../shared/app'
import type { GitHubPullRequestsState } from '../workspace/useGitHubPullRequests'
import { Dropdown } from './Dropdown'
import { Input } from './Input'
import { Button } from './Button'
import { GitRefreshIcon } from './AppStatusStates'
import {
  GitHubPullRequestStateIcon,
  gitHubPullRequestStateLabels
} from './GitHubPullRequestStateIcon'

const options = appGitHubPullRequestStates.map((state) => ({
  value: state,
  label: gitHubPullRequestStateLabels[state],
  icon: <GitHubPullRequestStateIcon state={state} />
}))

export function GitHubPullRequestControls({
  state,
  disabled
}: {
  state: GitHubPullRequestsState
  disabled: boolean
}): React.ReactElement | null {
  const compact = useCompactLayout()
  if (state.detail.selected) return null
  const label =
    state.states.length === 4
      ? 'All states'
      : state.states.length === 0
        ? 'No states'
        : appGitHubPullRequestStates
            .filter((value) => state.states.includes(value))
            .map((value) => gitHubPullRequestStateLabels[value])
            .join(', ')
  const search = (
    <Input
      type="search"
      aria-label="Search pull requests"
      placeholder="Search pull requests"
      maxLength={256}
      value={state.search}
      disabled={disabled}
      onChange={(event) => state.setSearch(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') state.setSearch('')
      }}
    />
  )
  return (
    <>
      <div
        className="changes-sidebar__controls changes-sidebar__controls--pull-requests"
        aria-label="Pull request controls"
      >
        <Dropdown
          aria-label="Pull request states"
          icon={<ListFilter aria-hidden="true" />}
          options={options}
          value={state.states[0] ?? 'open'}
          selectedValues={state.states}
          valueLabel={label}
          closeOnSelect={false}
          disabled={disabled}
          onChange={state.toggleState}
          fill
        />
        <Button
          theme="transparent"
          size="small"
          icon={<GitRefreshIcon />}
          aria-label="Refresh pull requests"
          title="Refresh pull requests"
          disabled={disabled || state.loading || state.loadingRows}
          callback={state.refresh}
        />
      </div>
      {compact ? (
        <div className="changes-sidebar__pull-request-search">
          {search}
          <Button
            theme="secondary"
            aria-label="Clear pull request search"
            icon={<X />}
            disabled={!state.search}
            callback={() => state.setSearch('')}
          />
        </div>
      ) : (
        search
      )}
    </>
  )
}
