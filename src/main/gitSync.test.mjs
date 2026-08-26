import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  getNoUpstreamPushFailure,
  getPushDefaultForTarget,
  getPushToCurrentBranchArgs,
  getPushToUpstreamBranchArgs,
  getSameNameUpstreamPushArgs,
  getUpstreamBranchMismatchPushFailure,
  isNoUpstreamPushFailure,
  isUpstreamBranchMismatchPushFailure,
  selectGitPushRemote
} from './gitSync.ts'

const execFileAsync = promisify(execFile)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const runGit = (cwd, args) => execFileAsync('git', args, { cwd, encoding: 'utf8' })

test('recognizes the standard missing-upstream push error', () => {
  assert.equal(
    isNoUpstreamPushFailure('fatal: The current branch feature/demo has no upstream branch.'),
    true
  )
  assert.equal(isNoUpstreamPushFailure('fatal: failed to push some refs'), false)
})

test('offers a same-name upstream recovery', () => {
  const error = 'fatal: The current branch feature/demo has no upstream branch.'
  assert.deepEqual(getNoUpstreamPushFailure('feature/demo', 'git push', error), {
    kind: 'push-no-upstream',
    title: 'Branch has no upstream',
    message: 'The local branch feature/demo is not connected to a remote branch yet.',
    command: 'git push',
    error,
    actions: [
      {
        id: 'set-upstream',
        label: 'Set upstream',
        description: 'Push feature/demo and track a remote branch with the same name.'
      }
    ]
  })
})

test('builds an explicit same-name push refspec', () => {
  assert.deepEqual(getSameNameUpstreamPushArgs('fork', 'feature/demo'), [
    'push',
    '--set-upstream',
    'fork',
    'feature/demo:feature/demo'
  ])
})

test('recognizes an upstream branch name mismatch', () => {
  assert.equal(
    isUpstreamBranchMismatchPushFailure(
      'fatal: The upstream branch of your current branch does not match the name of your current branch.'
    ),
    true
  )
  assert.equal(isUpstreamBranchMismatchPushFailure('fatal: failed to push some refs'), false)
})

test('offers both explicit targets for an upstream branch name mismatch', () => {
  const error =
    'fatal: The upstream branch of your current branch does not match the name of your current branch.'
  assert.deepEqual(
    getUpstreamBranchMismatchPushFailure('main', 'release/main', 'git push', error),
    {
      kind: 'push-upstream-mismatch',
      title: 'Upstream branch name differs',
      message: 'The local branch main tracks the differently named remote branch release/main.',
      command: 'git push',
      error,
      actions: [
        {
          id: 'push-current-branch',
          label: 'Push to main',
          description: 'Push HEAD to the remote branch main.'
        },
        {
          id: 'push-upstream-branch',
          label: 'Push to release/main',
          description: 'Push HEAD to the configured upstream branch release/main.'
        }
      ]
    }
  )
})

test('builds explicit push arguments for both mismatched branch targets', () => {
  assert.deepEqual(getPushToCurrentBranchArgs('origin'), ['push', 'origin', 'HEAD'])
  assert.deepEqual(getPushToUpstreamBranchArgs('origin', 'release/main'), [
    'push',
    'origin',
    'HEAD:release/main'
  ])
})

test('maps remembered mismatch targets to repository push defaults', () => {
  assert.equal(getPushDefaultForTarget('current-branch'), 'current')
  assert.equal(getPushDefaultForTarget('upstream-branch'), 'upstream')
})

test('selects the configured push remote before safe fallbacks', () => {
  assert.equal(selectGitPushRemote(['origin', 'fork'], ['fork', null, 'origin']), 'fork')
  assert.equal(selectGitPushRemote(['origin', 'fork'], [null, null, null]), 'origin')
  assert.equal(selectGitPushRemote(['company'], [null, null, null]), 'company')
  assert.throws(
    () => selectGitPushRemote(['company', 'personal'], [null, null, null]),
    /unable to choose a push remote/i
  )
})

test('same-name recovery establishes the expected upstream against a real remote', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'sele-git-sync-test-'))
  const remoteRoot = join(testRoot, 'remote.git')
  const repositoryRoot = join(testRoot, 'work')

  try {
    await runGit(testRoot, ['init', '--quiet', '--bare', remoteRoot])
    await runGit(testRoot, [
      'init',
      '--quiet',
      '--initial-branch=feature/same-name',
      repositoryRoot
    ])
    await runGit(repositoryRoot, ['config', 'user.name', 'Sele Test'])
    await runGit(repositoryRoot, ['config', 'user.email', 'sele@example.test'])
    await runGit(repositoryRoot, ['remote', 'add', 'fork', remoteRoot])
    await writeFile(join(repositoryRoot, 'tracked.txt'), 'tracked\n')
    await runGit(repositoryRoot, ['add', 'tracked.txt'])
    await runGit(repositoryRoot, ['commit', '--quiet', '-m', 'initial'])

    let pushError = ''
    try {
      await runGit(repositoryRoot, ['push'])
    } catch (error) {
      pushError = String(error.stderr ?? error)
    }
    assert.equal(isNoUpstreamPushFailure(pushError), true)

    await runGit(repositoryRoot, getSameNameUpstreamPushArgs('fork', 'feature/same-name'))

    const upstream = await runGit(repositoryRoot, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}'
    ])
    const remoteBranch = await runGit(repositoryRoot, [
      'ls-remote',
      '--heads',
      'fork',
      'feature/same-name'
    ])

    assert.equal(upstream.stdout.trim(), 'fork/feature/same-name')
    assert.match(remoteBranch.stdout, /refs\/heads\/feature\/same-name/)
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
})
