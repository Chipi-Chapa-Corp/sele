import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ListFilter } from 'lucide-react'
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
}): React.ReactElement {
  const [pageInput, setPageInput] = useState(String(state.page))
  useEffect(() => setPageInput(String(state.page)), [state.page])
  const commitPage = (): void => {
    const value = Number(pageInput)
    const page = Number.isFinite(value)
      ? Math.max(1, Math.min(state.pageCount, Math.trunc(value)))
      : 1
    setPageInput(String(page))
    state.goToPage(page)
  }
  const label =
    state.states.length === 4
      ? 'All states'
      : state.states.length === 0
        ? 'No states'
        : appGitHubPullRequestStates
            .filter((value) => state.states.includes(value))
            .map((value) => gitHubPullRequestStateLabels[value])
            .join(', ')

  return (
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
      <div className="changes-sidebar__titlebar-actions">
        {state.pageCount > 1 && (
          <>
            <Button
              theme="transparent"
              size="small"
              icon={<ChevronLeft aria-hidden="true" />}
              aria-label="Previous page"
              title="Previous page"
              disabled={!state.canGoPrevious}
              callback={state.previous}
            />
            <Input
              className="changes-sidebar__page-input"
              type="number"
              min={1}
              max={state.pageCount}
              step={1}
              aria-label="Pull request page"
              title={`Page ${state.page} of ${state.pageCount}`}
              value={pageInput}
              disabled={state.loading}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={commitPage}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitPage()
                }
              }}
            />
            <Button
              theme="transparent"
              size="small"
              icon={<ChevronRight aria-hidden="true" />}
              aria-label="Next page"
              title="Next page"
              disabled={!state.canGoNext}
              callback={state.next}
            />
          </>
        )}
        <Button
          theme="transparent"
          size="small"
          icon={<GitRefreshIcon />}
          aria-label="Refresh pull requests"
          title="Refresh pull requests"
          disabled={disabled || state.loading}
          callback={state.refresh}
        />
      </div>
    </div>
  )
}
