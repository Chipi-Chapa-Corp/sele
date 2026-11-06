import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  gitHubRepositoryFromRemote,
  resolveGitHubRepository,
  listGitHubPullRequests,
  getGitHubPullRequest,
  getGitHubPullRequestChanges,
  submitGitHubPullRequestReview,
  getGitHubPullRequestManagement,
  getGitHubPullRequestCommitChanges,
  performGitHubPullRequestAction
} from './githubPullRequests.ts'

const exec = promisify(execFile)
const git = async (cwd, args) => (await exec('git', args, { cwd })).stdout.trimEnd()
const remotes = (...pairs) => pairs.map(([name, url]) => `${name}\t${url} (fetch)`).join('\n')
const response = (options = {}) =>
  JSON.stringify({
    total_count: 21,
    incomplete_results: false,
    items: [
      {
        number: 123,
        title: 'A useful change',
        html_url: 'https://github.com/Example/App/pull/123',
        state: 'open',
        draft: true,
        pull_request: { merged_at: null },
        user: null
      }
    ],
    ...options
  })

test('GitHub remote identity accepts HTTPS and SSH and rejects lookalike hosts and invalid paths', () => {
  for (const url of [
    'https://github.com/Example/App.git',
    'git@github.com:Example/App.git',
    'ssh://git@github.com/Example/App.git',
    'https://user@github.com/Example/App/'
  ]) {
    assert.equal(gitHubRepositoryFromRemote(url), 'Example/App')
  }
  for (const url of [
    'https://github.com.evil.test/Example/App',
    'https://gitlab.com/Example/App',
    'git@github.com:Example/App/extra',
    '/local/repo',
    'https://github.com/Example/',
    'https://github.com/Example/<invalid>'
  ]) {
    assert.equal(gitHubRepositoryFromRemote(url), null)
  }
})

test('repository discovery prefers origin, falls back to upstream or a single GitHub repository, and reports ambiguity', () => {
  const origin = ['origin', 'git@github.com:mine/fork.git']
  const upstream = ['upstream', 'https://github.com/team/app.git']
  assert.equal(resolveGitHubRepository(remotes(upstream, origin)), 'mine/fork')
  assert.equal(resolveGitHubRepository(remotes(['origin', '/local/repo'], upstream)), 'team/app')
  assert.equal(resolveGitHubRepository(remotes(['team', upstream[1]])), 'team/app')
  assert.throws(
    () => resolveGitHubRepository(remotes(['one', upstream[1]], ['two', origin[1]])),
    /Multiple GitHub/
  )
  assert.throws(() => resolveGitHubRepository(''), /no GitHub remote/)
})

test('a real checkout selects its repository and retrieves numbered pages', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'sele-github-prs-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await git(cwd, ['init', '--quiet'])
  await git(cwd, ['remote', 'add', 'origin', 'git@github.com:Example/App.git'])
  const first = await listGitHubPullRequests(cwd, {}, git, async (args) => {
    assert.ok(args.includes('page=1'))
    assert.match(
      args.find((arg) => arg.startsWith('q=')),
      /repo:Example\/App/
    )
    return response()
  })
  assert.equal(first.repository, 'Example/App')
  assert.equal(first.pullRequests[0].state, 'draft')
  assert.equal(first.pullRequests[0].author, null)
  assert.equal(first.pageCount, 2)
  const last = await listGitHubPullRequests(
    cwd,
    { page: 2, states: ['closed', 'merged'] },
    git,
    async (args) => {
      assert.ok(args.includes('page=2'))
      assert.match(
        args.find((arg) => arg.startsWith('q=')),
        /is:closed is:unmerged/
      )
      return response()
    }
  )
  assert.equal(last.page, 2)
})

const runGit = async () => remotes(['origin', 'https://github.com/Example/App.git'])

test('merged and closed lifecycle states take precedence over the draft flag', async () => {
  const items = [
    { state: 'open', draft: false, pull_request: { merged_at: null } },
    { state: 'open', draft: true, pull_request: { merged_at: null } },
    { state: 'closed', draft: true, pull_request: { merged_at: null } },
    { state: 'closed', draft: false, pull_request: { merged_at: '2026-11-04T00:00:00Z' } }
  ].map((item, index) => ({
    number: index + 1,
    title: 'Fixture',
    html_url: `https://github.com/Example/App/pull/${index + 1}`,
    user: null,
    ...item
  }))
  const page = await listGitHubPullRequests(
    '/repo',
    { states: ['open', 'draft', 'closed', 'merged'] },
    runGit,
    async () => response({ items })
  )
  assert.deepEqual(
    page.pullRequests.map((pr) => pr.state),
    ['open', 'draft', 'closed', 'merged']
  )
})

test('page jumps clamp when the result count shrinks, and search availability bounds the last page', async () => {
  const pages = []
  const result = await listGitHubPullRequests('/repo', { page: 8 }, runGit, async (args) => {
    pages.push(args.find((arg) => arg.startsWith('page=')))
    return response()
  })
  assert.equal(result.page, 2)
  assert.deepEqual(pages, ['page=8', 'page=2'])
  const large = await listGitHubPullRequests('/repo', { page: 50 }, runGit, async () =>
    response({ total_count: 1450 })
  )
  assert.equal(large.pageCount, 50)
})

test('search stays scoped to the repository and treats titles as literal text', async () => {
  const queries = []
  for (const search of ['#123', 'hello there', 'repo:elsewhere/project OR "other"']) {
    await listGitHubPullRequests('/repo', { search }, runGit, async (args) => {
      queries.push(args.find((arg) => arg.startsWith('q=')))
      return response()
    })
  }
  assert.match(queries[0], /repo:Example\/App.* 123$/)
  assert.ok(queries[1].endsWith(' "hello" "there" in:title'))
  assert.ok(
    queries[2].endsWith(
      ` ${['repo:elsewhere/project', 'OR', '"other"'].map((word) => JSON.stringify(word)).join(' ')} in:title`
    )
  )
})

test('no selected states produce an empty page without calling GitHub', async () => {
  const result = await listGitHubPullRequests('/repo', { states: [] }, runGit, () =>
    assert.fail('No selected states')
  )
  assert.equal(result.pageCount, 1)
  assert.equal(result.totalCount, 0)
  assert.deepEqual(result.pullRequests, [])
})

test('unsupported projects and invalid, incomplete, or failed responses do not produce browser links', async () => {
  await assert.rejects(
    listGitHubPullRequests(
      '/repo',
      {},
      async () => '',
      () => assert.fail('No GitHub remote')
    ),
    /no GitHub remote/
  )
  for (const [body, message] of [
    [JSON.stringify({ message: 'Bad response' }), /invalid pull request page/],
    [response({ incomplete_results: true }), /incomplete search results/],
    [
      response({
        items: [
          {
            number: 123,
            title: 'Unsafe',
            draft: false,
            state: 'open',
            pull_request: { merged_at: null },
            html_url: 'javascript:alert(1)'
          }
        ]
      }),
      /invalid pull request/
    ],
    [response({ total_count: -1 }), /invalid pull request page/]
  ]) {
    await assert.rejects(
      listGitHubPullRequests('/repo', {}, runGit, async () => body),
      message
    )
  }
  await assert.rejects(
    listGitHubPullRequests('/repo', {}, runGit, async () => {
      throw new Error('Authentication required')
    }),
    /Authentication required/
  )
})

const detailResponse = (overrides = {}) => ({
  number: 123,
  title: 'Native PR details',
  url: 'https://github.com/Example/App/pull/123',
  state: 'OPEN',
  isDraft: false,
  author: { login: 'kitkat' },
  body: '**Description**',
  baseRefName: 'main',
  headRefName: 'feature/details',
  createdAt: '2026-11-01T12:00:00Z',
  updatedAt: '2026-11-03T12:00:00Z',
  mergedAt: null,
  closedAt: null,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  reviewDecision: 'APPROVED',
  comments: [],
  reviews: [],
  ...overrides
})
const detailGit = async () => remotes(['origin', 'git@github.com:Example/App.git'])
const detailOptions = { repository: 'Example/App', number: 123 }
const detailCli =
  (overrides = {}, timeline = [[]]) =>
  async (args) =>
    JSON.stringify(
      args.some((arg) => arg.includes('/pulls/123/comments'))
        ? [[]]
        : args.includes('--slurp')
          ? timeline
          : args[0] === 'api'
            ? { login: 'kitkat' }
            : detailResponse(overrides)
    )

test('pull request details use the project remote and combine comments and submitted reviews chronologically', async () => {
  const result = await getGitHubPullRequest('/project', detailOptions, detailGit, async (args) => {
    if (args.includes('--slurp')) return JSON.stringify([[]])
    if (args[0] === 'api') {
      assert.deepEqual(args, ['api', '--hostname', 'github.com', 'user'])
      return JSON.stringify({ login: 'SignedInUser' })
    }
    assert.deepEqual(args.slice(0, 6), [
      'pr',
      'view',
      '123',
      '--repo',
      'https://github.com/Example/App',
      '--json'
    ])
    return JSON.stringify(
      detailResponse({
        comments: [
          { id: 'c1', author: null, body: 'A comment', createdAt: '2026-11-03T10:00:00Z' }
        ],
        reviews: [
          {
            id: 'r1',
            author: { login: 'reviewer' },
            body: 'Looks good',
            submittedAt: '2026-11-02T10:00:00Z',
            state: 'APPROVED'
          },
          {
            id: 'r2',
            author: { login: 'reviewer' },
            body: 'Unsubmitted',
            submittedAt: null,
            state: 'PENDING'
          }
        ]
      })
    )
  })
  assert.equal(result.viewerLogin, 'SignedInUser')
  assert.equal(result.author, 'kitkat')
  assert.equal(result.body, '**Description**')
  assert.equal(result.headRefName, 'feature/details')
  assert.deepEqual(
    result.activity.map((item) => [item.kind, item.author, item.body]),
    [
      ['review', 'reviewer', 'Looks good'],
      ['comment', null, 'A comment']
    ]
  )
})

test('discussion includes paginated inline reviews, replies and outdated locations without duplicate summaries', async () => {
  const submittedAt = '2026-11-02T10:00:00Z'
  const timeline = [
    [
      {
        event: 'reviewed',
        id: 41,
        node_id: 'r41',
        user: { login: 'reviewer' },
        body: 'Please adjust these lines',
        submitted_at: submittedAt,
        state: 'changes_requested'
      }
    ],
    [
      {
        event: 'reviewed',
        id: 42,
        node_id: 'r42',
        user: { login: 'kitkat' },
        body: '',
        submitted_at: '2026-11-03T10:00:00Z',
        state: 'commented'
      }
    ]
  ]
  const comment = {
    id: 1,
    pull_request_review_id: 41,
    user: { login: 'reviewer' },
    body: 'Handle this case',
    created_at: '2026-11-02T09:00:00Z',
    path: 'src/main.ts',
    line: 14,
    original_line: 14,
    start_line: 12,
    side: 'RIGHT',
    html_url: 'https://github.com/Example/App/pull/123#discussion_r1'
  }
  const result = await getGitHubPullRequest('/repo', detailOptions, detailGit, async (args) => {
    if (args.some((arg) => arg.includes('/pulls/123/comments'))) {
      assert.ok(args.includes('--paginate') && args.includes('--slurp'))
      return JSON.stringify([
        [comment],
        [
          {
            ...comment,
            id: 2,
            pull_request_review_id: 42,
            user: { login: 'kitkat' },
            body: 'Fixed in the next commit',
            created_at: '2026-11-03T09:00:00Z',
            in_reply_to_id: 1,
            line: null,
            original_line: 8,
            start_line: null,
            original_start_line: 6,
            side: 'LEFT'
          }
        ]
      ])
    }
    return detailCli(
      {
        reviews: [
          {
            id: 'r41',
            author: { login: 'reviewer' },
            body: 'Please adjust these lines',
            submittedAt,
            state: 'CHANGES_REQUESTED'
          }
        ]
      },
      timeline
    )(args)
  })
  assert.deepEqual(
    result.activity.map((item) => [item.id, item.author, item.state]),
    [
      ['review:r41', 'reviewer', 'CHANGES_REQUESTED'],
      ['review-comment:1', 'reviewer', null],
      ['review:r42', 'kitkat', 'COMMENTED'],
      ['review-comment:2', 'kitkat', null]
    ]
  )
  assert.equal(result.activity[1].createdAt, submittedAt)
  assert.deepEqual(result.activity[1].reviewComment, {
    path: 'src/main.ts',
    line: 14,
    startLine: 12,
    side: 'new',
    outdated: false,
    url: comment.html_url
  })
  assert.deepEqual(result.activity[3].reviewComment, {
    path: 'src/main.ts',
    line: 8,
    startLine: 6,
    side: 'old',
    outdated: true,
    url: comment.html_url
  })
  await assert.rejects(
    () =>
      getGitHubPullRequest('/repo', detailOptions, detailGit, async (args) =>
        args.some((arg) => arg.includes('/pulls/123/comments'))
          ? JSON.stringify([[{ ...comment, line: 'invalid' }]])
          : detailCli()(args)
      ),
    /invalid review comments/
  )
})

test('detail status preserves merged and closed precedence over draft', async () => {
  for (const [state, isDraft, expected] of [
    ['OPEN', false, 'open'],
    ['OPEN', true, 'draft'],
    ['CLOSED', true, 'closed'],
    ['MERGED', true, 'merged']
  ]) {
    const result = await getGitHubPullRequest(
      '/project',
      detailOptions,
      detailGit,
      detailCli({ state, isDraft })
    )
    assert.equal(result.state, expected)
  }
})

test('detail lookup rejects a changed repository, invalid numbers, malformed data and mismatched PR identity', async () => {
  const unexpected = async () => {
    throw new Error('Should not call GitHub')
  }
  await assert.rejects(
    () =>
      getGitHubPullRequest(
        '/project',
        { ...detailOptions, repository: 'Other/App' },
        detailGit,
        unexpected
      ),
    /repository changed/
  )
  for (const number of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(
      () => getGitHubPullRequest('/project', { ...detailOptions, number }, detailGit, unexpected),
      /Invalid.*number/
    )
  for (const overrides of [{ body: 42 }, { comments: null }, { createdAt: 'invalid' }])
    await assert.rejects(
      () => getGitHubPullRequest('/project', detailOptions, detailGit, detailCli(overrides)),
      /invalid.*details/
    )
  for (const overrides of [{ number: 999 }, { url: 'https://github.com/Other/App/pull/123' }])
    await assert.rejects(
      () => getGitHubPullRequest('/project', detailOptions, detailGit, detailCli(overrides)),
      /different pull request/
    )
  await assert.rejects(
    () =>
      getGitHubPullRequest('/project', detailOptions, detailGit, async () => {
        throw new Error('Authentication failed')
      }),
    /Authentication failed/
  )
})

test('detail identity follows the authenticated GitHub account and requires a valid viewer', async () => {
  for (const login of ['different-account', 'OtherUser']) {
    const result = await getGitHubPullRequest('/project', detailOptions, detailGit, async (args) =>
      JSON.stringify(
        args.includes('--slurp') ? [[]] : args[0] === 'api' ? { login } : detailResponse()
      )
    )
    assert.equal(result.viewerLogin, login)
    assert.equal(result.author, 'kitkat')
  }
  await assert.rejects(
    () =>
      getGitHubPullRequest('/project', detailOptions, detailGit, async (args) =>
        JSON.stringify(args[0] === 'api' ? {} : detailResponse())
      ),
    /invalid authenticated user/
  )
})

const event = (type, id, time, actor = 'maintainer') => ({
  event: type,
  id,
  created_at: time,
  actor: actor ? { login: actor } : null
})
test('timeline includes commits and state changes from every page, uses the status actor, and collapses merge/close duplicates', async () => {
  const mergedAt = '2026-11-03T12:00:00Z'
  const timeline = [
    [
      {
        event: 'committed',
        sha: 'a'.repeat(40),
        message: 'Fix the thing\n\nDetails',
        author: { name: 'Contributor', date: '2026-11-01T10:00:00Z' },
        committer: { name: 'Contributor', date: '2026-11-01T10:00:00Z' }
      },
      { event: 'commented' },
      event('closed', 1, '2026-11-01T12:00:00Z', 'closer')
    ],
    [
      event('reopened', 2, '2026-11-02T12:00:00Z', 'reopener'),
      event('merged', 3, mergedAt),
      event('closed', 4, mergedAt)
    ]
  ]
  const result = await getGitHubPullRequest('/project', detailOptions, detailGit, async (args) => {
    if (args.some((arg) => arg.includes('/issues/123/timeline')))
      assert.deepEqual(args, [
        'api',
        '--hostname',
        'github.com',
        '--paginate',
        '--slurp',
        'repos/Example/App/issues/123/timeline?per_page=100'
      ])
    return detailCli({ state: 'MERGED', mergedAt, closedAt: mergedAt }, timeline)(args)
  })
  assert.deepEqual(
    result.activity.map((item) => item.state),
    ['committed', 'closed', 'reopened', 'merged']
  )
  assert.equal(result.activity[0].commitSha, 'a'.repeat(40))
  assert.equal(result.activity[0].body, 'Fix the thing')
  assert.equal(result.statusAuthor, 'maintainer')
  assert.equal(result.statusAt, mergedAt)
})

test('current PR status uses the latest relevant event, with opening metadata as a fallback', async () => {
  for (const [overrides, type, expected] of [
    [{ state: 'CLOSED' }, 'closed', 'closer'],
    [{ state: 'OPEN' }, 'reopened', 'reopener'],
    [{ state: 'OPEN', isDraft: true }, 'convert_to_draft', 'drafter'],
    [{ state: 'OPEN' }, 'ready_for_review', 'reviewer']
  ]) {
    const result = await getGitHubPullRequest(
      '/project',
      detailOptions,
      detailGit,
      detailCli(overrides, [[event(type, 1, '2026-11-03T12:00:00Z', expected)]])
    )
    assert.equal(result.statusAuthor, expected)
    assert.equal(result.statusAt, '2026-11-03T12:00:00Z')
  }
  const result = await getGitHubPullRequest('/project', detailOptions, detailGit, detailCli())
  assert.equal(result.statusAuthor, 'kitkat')
  assert.equal(result.statusAt, result.createdAt)
})

test('malformed timeline and commit events fail rather than silently omitting updates', async () => {
  for (const timeline of [{}, [[{ event: 'merged' }]], [[{ event: 'committed', sha: 'invalid' }]]])
    await assert.rejects(
      () => getGitHubPullRequest('/project', detailOptions, detailGit, detailCli({}, timeline)),
      /invalid.*event/
    )
})

const commitId = 'a'.repeat(40)
const head = { head: { sha: commitId }, changed_files: 3 }

test('PR changes paginate GitHub files and preserve rename, deletion, and binary snapshots', async () => {
  const calls = []
  const changes = await getGitHubPullRequestChanges(
    '/repo',
    detailOptions,
    detailGit,
    async (args) => {
      calls.push(args)
      return JSON.stringify(
        args.includes('--slurp')
          ? [
              [
                {
                  filename: 'src/new.ts',
                  previous_filename: 'src/old.ts',
                  status: 'renamed',
                  patch: '@@ -1 +1 @@\n-old\n+new'
                },
                { filename: 'deleted.txt', status: 'removed', patch: '@@ -1 +0,0 @@\n-old' }
              ],
              [{ filename: 'picture.png', status: 'added' }]
            ]
          : head
      )
    }
  )
  assert.equal(changes.commitId, commitId)
  assert.equal(changes.files.length, 3)
  assert.equal(changes.files[0].kind, 'rename')
  assert.match(changes.files[0].diff, /--- a\/src\/old.ts/)
  assert.match(changes.files[1].diff, /\+\+\+ \/dev\/null/)
  assert.equal(changes.files[2].diff, '')
  assert.ok(calls[1].includes('repos/Example/App/pulls/123/files?per_page=100'))
})

test('PR changes reject racing head updates and incomplete file pages', async () => {
  let reads = 0
  await assert.rejects(
    getGitHubPullRequestChanges('/repo', detailOptions, detailGit, async (args) => {
      if (args.includes('--slurp')) return '[[]]'
      return JSON.stringify({ ...head, head: { sha: ++reads === 1 ? commitId : 'b'.repeat(40) } })
    }),
    /changed while loading/
  )
  await assert.rejects(
    getGitHubPullRequestChanges('/repo', detailOptions, detailGit, async (args) =>
      JSON.stringify(args.includes('--slurp') ? [[]] : head)
    ),
    /all changed files/
  )
})

test('one posted review includes its summary and both sides of multiline comments', async () => {
  const calls = []
  const comments = [
    { id: '1', path: 'src/new.ts', comment: 'Check new lines', line: 4, endLine: 6, side: 'new' },
    { id: '2', path: 'deleted.txt', comment: 'Keep this?', line: 2, side: 'old' }
  ]
  await submitGitHubPullRequestReview(
    '/repo',
    { ...detailOptions, commitId, body: 'Review summary', comments },
    detailGit,
    async (args, input) => {
      calls.push({ args, input })
      return JSON.stringify(head)
    }
  )
  assert.equal(calls.length, 2)
  assert.ok(calls[1].args.includes('repos/Example/App/pulls/123/reviews'))
  assert.deepEqual(JSON.parse(calls[1].input), {
    commit_id: commitId,
    body: 'Review summary',
    event: 'COMMENT',
    comments: [
      {
        path: 'src/new.ts',
        body: 'Check new lines',
        line: 6,
        side: 'RIGHT',
        start_line: 4,
        start_side: 'RIGHT'
      },
      { path: 'deleted.txt', body: 'Keep this?', line: 2, side: 'LEFT' }
    ]
  })
})

test('review submission preserves drafts by rejecting stale heads and invalid input before posting', async () => {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    return JSON.stringify(head)
  }
  await assert.rejects(
    submitGitHubPullRequestReview(
      '/repo',
      { ...detailOptions, commitId: 'b'.repeat(40), body: 'Summary', comments: [] },
      detailGit,
      run
    ),
    /new commits/
  )
  assert.equal(calls.length, 1)
  for (const change of [
    { body: ' ' },
    { comments: [{ id: '1', path: '../secret', comment: 'Bad', line: 1, side: 'new' }] }
  ])
    await assert.rejects(
      submitGitHubPullRequestReview(
        '/repo',
        { ...detailOptions, commitId, body: 'Summary', comments: [], ...change },
        detailGit,
        run
      )
    )
  assert.equal(calls.length, 1)
  await assert.rejects(
    submitGitHubPullRequestReview(
      '/repo',
      { ...detailOptions, repository: 'Other/Repo', commitId, body: 'Summary', comments: [] },
      detailGit,
      run
    ),
    /repository changed/
  )
})

const managementResponse = (
  repo = {},
  pr = {},
  rollup = { state: 'SUCCESS', contexts: { totalCount: 4 } }
) =>
  JSON.stringify({
    data: {
      repository: {
        viewerDefaultMergeMethod: 'SQUASH',
        viewerPermission: 'WRITE',
        mergeCommitAllowed: true,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        ...repo,
        pullRequest: {
          headRefOid: commitId,
          state: 'OPEN',
          isDraft: false,
          mergeable: 'MERGEABLE',
          viewerCanUpdate: true,
          commits: { nodes: [{ commit: { statusCheckRollup: rollup } }] },
          ...pr
        }
      }
    }
  })

test('management uses repository merge methods and the repository viewer default, with CI rollup status', async () => {
  const data = await getGitHubPullRequestManagement(
    '/repo',
    detailOptions,
    detailGit,
    async (args) => {
      assert.ok(args.includes('graphql'))
      assert.ok(args.includes('owner=Example'))
      assert.ok(args.includes('name=App'))
      return managementResponse()
    }
  )
  assert.deepEqual(data, {
    headSha: commitId,
    mergeMethods: ['merge', 'squash', 'rebase'],
    defaultMergeMethod: 'squash',
    canMerge: true,
    canClose: true,
    checks: 'success',
    checkCount: 4
  })
  const limited = await getGitHubPullRequestManagement(
    '/repo',
    detailOptions,
    detailGit,
    async () => managementResponse({ squashMergeAllowed: false, rebaseMergeAllowed: false })
  )
  assert.deepEqual(limited.mergeMethods, ['merge'])
  assert.equal(limited.defaultMergeMethod, 'merge')
  for (const [rollup, status] of [
    [null, 'none'],
    [{ state: 'PENDING', contexts: { totalCount: 1 } }, 'pending'],
    [{ state: 'FAILURE', contexts: { totalCount: 1 } }, 'failure'],
    [{ state: 'ERROR', contexts: { totalCount: 1 } }, 'failure']
  ]) {
    const result = await getGitHubPullRequestManagement(
      '/repo',
      detailOptions,
      detailGit,
      async () => managementResponse({}, {}, rollup)
    )
    assert.equal(result.checks, status)
  }
})

test('management prevents merging drafts, closed PRs, conflicts and accounts without write access', async () => {
  for (const [repo, pr] of [
    [{}, { isDraft: true }],
    [{}, { state: 'MERGED', viewerCanUpdate: false }],
    [{}, { mergeable: 'CONFLICTING' }],
    [{ viewerPermission: 'READ' }, {}]
  ]) {
    const result = await getGitHubPullRequestManagement(
      '/repo',
      detailOptions,
      detailGit,
      async () => managementResponse(repo, pr)
    )
    assert.equal(result.canMerge, false)
  }
})

test('ordinary comments post to the issue discussion and preserve literal Markdown', async () => {
  const calls = []
  const body = '    code $(literal) `text`\n\nComment'
  await performGitHubPullRequestAction(
    '/repo',
    { ...detailOptions, action: 'comment', body },
    detailGit,
    async (args, input) => {
      calls.push({ args, input })
      return '{}'
    }
  )
  assert.equal(calls.length, 1)
  assert.ok(calls[0].args.includes('repos/Example/App/issues/123/comments'))
  assert.ok(calls[0].args.includes('POST'))
  assert.deepEqual(JSON.parse(calls[0].input), { body })
  await assert.rejects(() =>
    performGitHubPullRequestAction(
      '/repo',
      { ...detailOptions, action: 'comment', body: '   ' },
      detailGit,
      async () => assert.fail('empty comments must not post')
    )
  )
})

test('closing updates the PR state once and rejects merged PRs', async () => {
  const calls = []
  await performGitHubPullRequestAction(
    '/repo',
    { ...detailOptions, action: 'close' },
    detailGit,
    async (args, input) => {
      calls.push({ args, input })
      return input ? '{}' : JSON.stringify({ state: 'open', merged: false })
    }
  )
  assert.ok(calls[1].args.includes('PATCH'))
  assert.deepEqual(JSON.parse(calls[1].input), { state: 'closed' })
  let writes = 0
  await performGitHubPullRequestAction(
    '/repo',
    { ...detailOptions, action: 'close' },
    detailGit,
    async (_args, input) => {
      if (input) writes++
      return JSON.stringify({ state: 'closed', merged: false })
    }
  )
  assert.equal(writes, 0)
  await assert.rejects(
    () =>
      performGitHubPullRequestAction(
        '/repo',
        { ...detailOptions, action: 'close' },
        detailGit,
        async () => JSON.stringify({ state: 'closed', merged: true })
      ),
    /already been merged/
  )
})

test('merge sends the chosen method with a head SHA and leaves commit message defaults to GitHub', async () => {
  const calls = []
  await performGitHubPullRequestAction(
    '/repo',
    { ...detailOptions, action: 'merge', method: 'squash', headSha: commitId },
    detailGit,
    async (args, input) => {
      calls.push({ args, input })
      return input ? JSON.stringify({ merged: true }) : managementResponse()
    }
  )
  assert.ok(calls[1].args.includes('repos/Example/App/pulls/123/merge'))
  assert.ok(calls[1].args.includes('PUT'))
  assert.deepEqual(JSON.parse(calls[1].input), { sha: commitId, merge_method: 'squash' })
  for (const [options, response, reason] of [
    [{ headSha: 'b'.repeat(40) }, managementResponse(), /new commits/],
    [{}, managementResponse({ squashMergeAllowed: false }), /cannot be merged/],
    [{}, managementResponse({}, { isDraft: true }), /cannot be merged/]
  ])
    await assert.rejects(
      () =>
        performGitHubPullRequestAction(
          '/repo',
          { ...detailOptions, action: 'merge', method: 'squash', headSha: commitId, ...options },
          detailGit,
          async (_args, input) => {
            assert.equal(input, undefined)
            return response
          }
        ),
      reason
    )
  await assert.rejects(
    () =>
      performGitHubPullRequestAction(
        '/repo',
        { ...detailOptions, action: 'merge', method: 'squash', headSha: commitId },
        detailGit,
        async (_args, input) =>
          input
            ? JSON.stringify({ merged: false, message: 'Required checks are pending' })
            : managementResponse()
      ),
    /Required checks/
  )
})

test('commit snapshots validate PR membership and include only that commit’s files across pages', async () => {
  const calls = []
  const result = await getGitHubPullRequestCommitChanges(
    '/repo',
    { ...detailOptions, commitSha: commitId },
    detailGit,
    async (args) => {
      calls.push(args)
      if (args.some((arg) => arg.includes('/timeline?')))
        return JSON.stringify([[{ event: 'committed', sha: commitId }]])
      assert.ok(args.includes(`repos/Example/App/commits/${commitId}?per_page=100`))
      return JSON.stringify([
        {
          sha: commitId,
          files: [{ filename: 'one.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }]
        },
        {
          sha: commitId,
          files: [{ filename: 'two.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+new' }]
        }
      ])
    }
  )
  assert.deepEqual(
    result.files.map((file) => file.path),
    ['one.ts', 'two.ts']
  )
  assert.equal(result.commitId, commitId)
  assert.ok(!calls.some((args) => args.includes('repos/Example/App/pulls/123/files?per_page=100')))
  await assert.rejects(
    () =>
      getGitHubPullRequestCommitChanges(
        '/repo',
        { ...detailOptions, commitSha: commitId },
        detailGit,
        async () => JSON.stringify([[]])
      ),
    /does not belong/
  )
})
