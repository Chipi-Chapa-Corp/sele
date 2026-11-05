import type {
  AppGitHubPullRequestDetail,
  AppGitHubPullRequestChanges,
  AppGitHubPullRequestReviewOptions,
  AppGitHubPullRequestOptions,
  AppGitHubPullRequestsOptions,
  AppGitHubPullRequestsResult,
  AppGitHubPullRequestState
} from '../shared/app'
import { z } from 'zod'

type GitRunner = (cwd: string, args: string[], required: boolean) => Promise<string | null>
type GitHubRunner = (args: string[], input?: string) => Promise<string>

const authorSchema = z.object({ login: z.string() }).nullable()
const dateSchema = z.iso.datetime({ offset: true })
const detailSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  author: authorSchema,
  body: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  createdAt: dateSchema,
  updatedAt: dateSchema,
  mergedAt: dateSchema.nullable(),
  closedAt: dateSchema.nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  reviewDecision: z.string(),
  comments: z.array(
    z.object({
      id: z.string(),
      author: authorSchema,
      body: z.string(),
      createdAt: dateSchema
    })
  ),
  reviews: z.array(
    z.object({
      id: z.string(),
      author: authorSchema,
      body: z.string(),
      submittedAt: dateSchema.nullable(),
      state: z.string()
    })
  )
})

const stateEvents = new Set([
  'merged',
  'closed',
  'reopened',
  'ready_for_review',
  'convert_to_draft',
  'head_ref_force_pushed',
  'head_ref_deleted',
  'head_ref_restored'
])
const timelineSchema = z.array(z.array(z.object({ event: z.string() }).passthrough()))
const stateEventSchema = z.object({
  event: z.string(),
  id: z.number(),
  created_at: dateSchema,
  actor: authorSchema
})
const commitEventSchema = z.object({
  event: z.literal('committed'),
  sha: z.string().regex(/^[a-f\d]{40,64}$/i),
  message: z.string(),
  author: z.object({ name: z.string().nullable(), date: dateSchema }),
  committer: z.object({ name: z.string().nullable(), date: dateSchema })
})

export const getGitHubPullRequest = async (
  cwd: string,
  options: Pick<AppGitHubPullRequestOptions, 'repository' | 'number'>,
  runGit: GitRunner,
  runGitHub: GitHubRunner
): Promise<AppGitHubPullRequestDetail> => {
  if (!Number.isSafeInteger(options.number) || options.number < 1)
    throw new Error('Invalid GitHub pull request number.')
  const repository = resolveGitHubRepository((await runGit(cwd, ['remote', '-v'], true)) ?? '')
  if (repository.toLowerCase() !== options.repository.toLowerCase())
    throw new Error('The GitHub repository changed. Refresh the pull request list.')
  const fields = Object.keys(detailSchema.shape).join(',')
  const [pullRequestJson, viewerJson, timelineJson] = await Promise.all([
    runGitHub([
      'pr',
      'view',
      String(options.number),
      '--repo',
      `https://github.com/${repository}`,
      '--json',
      fields
    ]),
    runGitHub(['api', '--hostname', 'github.com', 'user']),
    runGitHub([
      'api',
      '--hostname',
      'github.com',
      '--paginate',
      '--slurp',
      `repos/${repository}/issues/${options.number}/timeline?per_page=100`
    ])
  ])
  const parsed = detailSchema.safeParse(JSON.parse(pullRequestJson))
  const viewer = z.object({ login: z.string().min(1) }).safeParse(JSON.parse(viewerJson))
  if (!viewer.success) throw new Error('GitHub returned an invalid authenticated user.')
  if (!parsed.success) throw new Error('GitHub returned invalid pull request details.')
  const { comments, reviews, state, author, ...pr } = parsed.data
  const timeline = timelineSchema.safeParse(JSON.parse(timelineJson))
  if (!timeline.success) throw new Error('GitHub returned invalid pull request events.')
  const events: AppGitHubPullRequestDetail['activity'] = timeline.data.flat().flatMap((item) => {
    if (item.event === 'committed') {
      const commit = commitEventSchema.safeParse(item)
      if (!commit.success) throw new Error('GitHub returned an invalid commit event.')
      return [
        {
          id: `commit:${commit.data.sha}`,
          kind: 'event' as const,
          state: 'committed',
          author: commit.data.author.name,
          body: commit.data.message.split('\n')[0],
          createdAt: commit.data.committer.date,
          commitSha: commit.data.sha
        }
      ]
    }
    if (!stateEvents.has(item.event)) return []
    const event = stateEventSchema.safeParse(item)
    if (!event.success) throw new Error('GitHub returned an invalid pull request event.')
    return [
      {
        id: `event:${event.data.id}`,
        kind: 'event' as const,
        state: event.data.event,
        author: event.data.actor?.login ?? null,
        body: '',
        createdAt: event.data.created_at
      }
    ]
  })
  if (
    pr.number !== options.number ||
    pr.url.toLowerCase() !== `https://github.com/${repository}/pull/${options.number}`.toLowerCase()
  )
    throw new Error('GitHub returned details for a different pull request.')
  const activity: AppGitHubPullRequestDetail['activity'] = [
    // A merge also emits a closed event at the same instant. Show the merge once.
    ...events.filter(
      (event) =>
        !(
          event.state === 'closed' &&
          events.some((other) => other.state === 'merged' && other.createdAt === event.createdAt)
        )
    ),
    ...comments.map((comment) => ({
      ...comment,
      id: `comment:${comment.id}`,
      author: comment.author?.login ?? null,
      kind: 'comment' as const,
      state: null
    })),
    ...reviews.flatMap((review) =>
      review.submittedAt
        ? [
            {
              id: `review:${review.id}`,
              author: review.author?.login ?? null,
              body: review.body,
              createdAt: review.submittedAt,
              kind: 'review' as const,
              state: review.state
            }
          ]
        : []
    )
  ].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  const statusEvents =
    state === 'MERGED'
      ? ['merged']
      : state === 'CLOSED'
        ? ['closed']
        : pr.isDraft
          ? ['convert_to_draft']
          : ['reopened', 'ready_for_review']
  const statusEvent = activity
    .filter((item) => item.kind === 'event' && statusEvents.includes(item.state ?? ''))
    .at(-1)
  return {
    ...pr,
    repository,
    viewerLogin: viewer.data.login,
    statusAuthor: statusEvent?.author ?? (state === 'OPEN' ? (author?.login ?? null) : null),
    statusAt: statusEvent?.createdAt ?? pr.mergedAt ?? pr.closedAt ?? pr.createdAt,
    author: author?.login ?? null,
    state:
      state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open',
    activity
  }
}

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
  options: Pick<AppGitHubPullRequestsOptions, 'page' | 'states' | 'search'>,
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
  const term = options.search?.trim().replace(/^#(?=\d+$)/, '') ?? ''
  const searchFilter = term
    ? /^\d+$/.test(term)
      ? ` ${term}`
      : ` ${term
          .split(/\s+/)
          .map((word) => JSON.stringify(word))
          .join(' ')} in:title`
    : ''
  const query = `repo:${repository} is:pr${filter}${searchFilter}`
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

const shaSchema = z.string().regex(/^[a-f\d]{40,64}$/i)
const prHeadSchema = z.object({
  head: z.object({ sha: shaSchema }),
  changed_files: z.number().int().nonnegative()
})
const changedFileSchema = z.object({
  filename: z.string().min(1),
  previous_filename: z.string().optional(),
  status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']),
  patch: z.string().optional()
})

const validatePullRequestRepository = async (
  cwd: string,
  options: Pick<AppGitHubPullRequestOptions, 'repository' | 'number'>,
  runGit: GitRunner
): Promise<string> => {
  if (!Number.isSafeInteger(options.number) || options.number < 1)
    throw new Error('Invalid GitHub pull request number.')
  const repository = resolveGitHubRepository((await runGit(cwd, ['remote', '-v'], true)) ?? '')
  if (repository.toLowerCase() !== options.repository.toLowerCase())
    throw new Error('The GitHub repository changed. Refresh the pull request list.')
  return `repos/${repository}/pulls/${options.number}`
}

export const getGitHubPullRequestChanges = async (
  cwd: string,
  options: Pick<AppGitHubPullRequestOptions, 'repository' | 'number'>,
  runGit: GitRunner,
  runGitHub: GitHubRunner
): Promise<AppGitHubPullRequestChanges> => {
  const endpoint = await validatePullRequestRepository(cwd, options, runGit)
  const readHead = async () =>
    prHeadSchema.parse(JSON.parse(await runGitHub(['api', '--hostname', 'github.com', endpoint])))
  const before = await readHead()
  const pages = z
    .array(z.array(changedFileSchema))
    .parse(
      JSON.parse(
        await runGitHub([
          'api',
          '--hostname',
          'github.com',
          '--paginate',
          '--slurp',
          `${endpoint}/files?per_page=100`
        ])
      )
    )
  const after = await readHead()
  if (before.head.sha !== after.head.sha || before.changed_files !== after.changed_files)
    throw new Error('The pull request changed while loading. Refresh its files.')
  const files = pages.flat()
  if (files.length !== after.changed_files)
    throw new Error('GitHub did not return all changed files. Open this pull request on GitHub.')
  return {
    commitId: after.head.sha,
    files: files.map((file) => ({
      path: file.filename,
      previousPath: file.previous_filename ?? null,
      kind:
        file.status === 'added' || file.status === 'copied'
          ? 'create'
          : file.status === 'removed'
            ? 'delete'
            : file.status === 'renamed'
              ? 'rename'
              : 'edit',
      diff: file.patch
        ? `--- ${file.status === 'added' ? '/dev/null' : `a/${file.previous_filename ?? file.filename}`}\n+++ ${file.status === 'removed' ? '/dev/null' : `b/${file.filename}`}\n${file.patch}\n`
        : ''
    }))
  }
}

export const gitHubPullRequestReviewSchema = z.object({
  commitId: shaSchema,
  body: z.string().trim().min(1).max(65536),
  comments: z.array(
    z
      .object({
        id: z.string(),
        path: z
          .string()
          .min(1)
          .refine(
            (path) =>
              !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0')
          ),
        comment: z.string().trim().min(1).max(65536),
        line: z.number().int().positive(),
        endLine: z.number().int().positive().optional(),
        side: z.enum(['old', 'new'])
      })
      .refine((comment) => comment.endLine === undefined || comment.endLine >= comment.line)
  )
})

export const submitGitHubPullRequestReview = async (
  cwd: string,
  options: AppGitHubPullRequestReviewOptions,
  runGit: GitRunner,
  runGitHub: GitHubRunner
): Promise<void> => {
  const review = gitHubPullRequestReviewSchema.parse(options)
  const endpoint = await validatePullRequestRepository(cwd, options, runGit)
  const head = prHeadSchema.parse(
    JSON.parse(await runGitHub(['api', '--hostname', 'github.com', endpoint]))
  )
  if (head.head.sha !== review.commitId)
    throw new Error(
      'The pull request has new commits. Refresh its files and check your comments before posting.'
    )
  const payload = {
    commit_id: review.commitId,
    body: review.body,
    event: 'COMMENT',
    comments: review.comments.map((comment) => {
      const side = comment.side === 'old' ? 'LEFT' : 'RIGHT'
      return {
        path: comment.path,
        body: comment.comment,
        line: comment.endLine ?? comment.line,
        side,
        ...(comment.endLine && comment.endLine > comment.line
          ? { start_line: comment.line, start_side: side }
          : {})
      }
    })
  }
  await runGitHub(
    ['api', '--hostname', 'github.com', '--method', 'POST', `${endpoint}/reviews`, '--input', '-'],
    JSON.stringify(payload)
  )
}
