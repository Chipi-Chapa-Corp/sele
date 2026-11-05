import {
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft
} from 'lucide-react'
import type { AppGitHubPullRequestState } from '../../../shared/app'

const icons = {
  open: GitPullRequestArrow,
  merged: GitMerge,
  closed: GitPullRequestClosed,
  draft: GitPullRequestDraft
}
export const gitHubPullRequestStateLabels: Record<AppGitHubPullRequestState, string> = {
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
  draft: 'Draft'
}

export function GitHubPullRequestStateIcon({
  state
}: {
  state: AppGitHubPullRequestState
}): React.ReactElement {
  const Icon = icons[state] ?? GitPullRequestArrow
  return (
    <Icon className="changes-sidebar__pull-request-icon" data-state={state} aria-hidden="true" />
  )
}
