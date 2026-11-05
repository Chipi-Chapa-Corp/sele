import {
  appGitHubPullRequestStates,
  type AppGitHubPullRequestsOptions,
  type AppGitHubPullRequestsResult
} from '../../../src/shared/app'

const titles = [
  'Keep project navigation responsive with large conversations',
  'Restore the selected worktree after reopening a project',
  'Add keyboard shortcuts for the Git sidebar',
  'Improve browser cookie imports',
  'Handle empty diffs when reviewing a pull request'
]

export function mockGitHubPullRequests(
  options: Pick<AppGitHubPullRequestsOptions, 'page' | 'states' | 'search'>,
  count = 100
): AppGitHubPullRequestsResult {
  const states = options.states ?? ['open', 'draft']
  const term =
    options.search
      ?.trim()
      .replace(/^#(?=\d+$)/, '')
      .toLowerCase() ?? ''
  const pullRequests = Array.from({ length: count }, (_, index) => {
    const number = 10000 + count - index
    const state = appGitHubPullRequestStates[index % appGitHubPullRequestStates.length]
    return {
      number,
      title: `[Mock] ${titles[index % titles.length]} (${index + 1})`,
      url: `https://github.com/example/sele/pull/${number}`,
      state,
      isDraft: state === 'draft',
      author: `test-author-${(index % 5) + 1}`
    }
  }).filter(
    (pr) =>
      states.includes(pr.state) &&
      (!term ||
        (/^\d+$/.test(term)
          ? pr.number === Number(term)
          : term.split(/\s+/).every((word) => pr.title.toLowerCase().includes(word))))
  )
  const pageCount = Math.max(1, Math.ceil(pullRequests.length / 20))
  const page = Math.max(1, Math.min(pageCount, Math.trunc(options.page ?? 1)))
  return {
    repository: 'mock/sele',
    totalCount: pullRequests.length,
    page,
    pageCount,
    pullRequests: pullRequests.slice((page - 1) * 20, page * 20)
  }
}
