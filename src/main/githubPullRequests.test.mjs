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
  listGitHubPullRequests
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
