import type {
  AppGitHubPullRequestsOptions,
  AppGitHubPullRequestsResult,
  AppGitHubPullRequestState
} from '../shared/app'

type GitRunner = (cwd: string, args: string[], required: boolean) => Promise<string | null>
type GitHubRunner = (args: string[]) => Promise<string>

export const gitHubRepositoryFromRemote = (remote: string): string | null => {
  let path: string
  if (remote.startsWith('git@github.com:')) {
    path = remote.slice('git@github.com:'.length)
  } else {
    try {
      const url = new URL(remote)
      if (
        url.hostname.toLowerCase() !== 'github.com' ||
        !['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)
      )
        return null
      path = url.pathname.slice(1)
    } catch {
      return null
    }
  }
  const match = /^([^/\s]+)\/([^/\s]+?)\/?$/.exec(path)
  if (!match) return null
  const owner = match[1]
  const name = match[2].replace(/\.git$/i, '')
  return /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(name) ? `${owner}/${name}` : null
}

export const resolveGitHubRepository = (remotes: string): string => {
  const repositories = remotes.split('\n').flatMap((line) => {
    const match = /^(\S+)\s+(.+) \(fetch\)$/.exec(line)
    const repository = match ? gitHubRepositoryFromRemote(match[2]) : null
    return match && repository ? [{ remote: match[1], repository }] : []
  })
  const preferred =
    repositories.find((item) => item.remote === 'origin') ??
    repositories.find((item) => item.remote === 'upstream')
  if (preferred) return preferred.repository
  const unique = [...new Set(repositories.map((item) => item.repository))]
  if (unique.length === 1) return unique[0]
  if (unique.length > 1)
    throw new Error(
      'Multiple GitHub repositories found. Set an origin remote to choose which pull requests to show.'
    )
  throw new Error(
    'This project has no GitHub remote. Add a github.com remote to see pull requests.'
  )
}

const pageSize = 20
// GitHub's search endpoint exposes the first 1,000 matches.
const maxSearchResults = 1000
const stateQueries: Record<AppGitHubPullRequestState, string> = {
  open: '(is:open -is:draft)',
  merged: 'is:merged',
  closed: '(is:closed is:unmerged)',
  draft: '(is:open is:draft)'
}

export const listGitHubPullRequests = async (
  cwd: string,
  options: Pick<AppGitHubPullRequestsOptions, 'page' | 'states'>,
  runGit: GitRunner,
  runGitHub: GitHubRunner
): Promise<AppGitHubPullRequestsResult> => {
  const remotes = await runGit(cwd, ['remote', '-v'], true)
  const repository = resolveGitHubRepository(remotes ?? '')
  const states = options.states ?? ['open', 'draft']
  if (states.length === 0)
    return { repository, totalCount: 0, page: 1, pageCount: 1, pullRequests: [] }
  const filter =
    states.length === 4 ? '' : ` (${states.map((state) => stateQueries[state]).join(' OR ')})`
  const query = `repo:${repository} is:pr${filter}`
  const search = async (page: number) => {
    const args = [
      'api',
      '--hostname',
      'github.com',
      '--method',
      'GET',
      'search/issues',
      '-f',
      `q=${query}`,
      '-f',
      'advanced_search=true',
      '-f',
      'sort=created',
      '-f',
      'order=desc',
      '-f',
      `per_page=${pageSize}`,
      '-f',
      `page=${page}`
    ]
    const response = JSON.parse(await runGitHub(args))
    if (response.incomplete_results)
      throw new Error('GitHub returned incomplete search results. Please retry.')
    if (
      !Array.isArray(response.items) ||
      !Number.isSafeInteger(response.total_count) ||
      response.total_count < 0
    ) {
      throw new Error('GitHub returned an invalid pull request page.')
    }
    return response
  }
  const requestedPage = Math.max(1, Math.min(50, Math.trunc(options.page ?? 1)))
  let response = await search(requestedPage)
  const pageCount = Math.max(
    1,
    Math.ceil(Math.min(response.total_count, maxSearchResults) / pageSize)
  )
  const page = Math.min(requestedPage, pageCount)
  if (page !== requestedPage) response = await search(page)
  return {
    repository,
    totalCount: response.total_count,
    page,
    pageCount,
    pullRequests: response.items.map(
      (pr: {
        number: number
        title: string
        html_url: string
        state: string
        draft: boolean
        pull_request: { merged_at: string | null }
        user: { login: string } | null
      }) => {
        if (
          !pr ||
          !Number.isSafeInteger(pr.number) ||
          pr.number < 1 ||
          typeof pr.title !== 'string' ||
          typeof pr.draft !== 'boolean' ||
          !['open', 'closed'].includes(pr.state) ||
          !pr.pull_request ||
          (pr.pull_request.merged_at !== null && typeof pr.pull_request.merged_at !== 'string') ||
          typeof pr.html_url !== 'string' ||
          pr.html_url.toLowerCase() !==
            `https://github.com/${repository}/pull/${pr.number}`.toLowerCase()
        ) {
          throw new Error('GitHub returned an invalid pull request.')
        }
        const state: AppGitHubPullRequestState = pr.pull_request.merged_at
          ? 'merged'
          : pr.state === 'closed'
            ? 'closed'
            : pr.draft
              ? 'draft'
              : 'open'
        return {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          isDraft: pr.draft,
          state,
          author: pr.user?.login ?? null
        }
      }
    )
  }
}
