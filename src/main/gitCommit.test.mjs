import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { commitAllGitChanges } from './gitCommit.ts'
import { getProcessFailureMessage } from './processFailure.ts'

const execFileAsync = promisify(execFile)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const runGit = async (cwd, args, options = false) => {
  const runOptions = typeof options === 'boolean' ? { required: options } : options

  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...runOptions.env }
    })
    return stdout.trimEnd()
  } catch (error) {
    if (!runOptions.required) return null

    throw new Error(
      getProcessFailureMessage(error, error.stdout, error.stderr, {
        label: args[0] ? `Git ${args[0]}` : 'Git command'
      })
    )
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const createRepository = async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'sele-git-commit-test-'))
  await runGit(repositoryRoot, ['init', '--quiet'], true)
  await runGit(repositoryRoot, ['config', 'user.name', 'Sele Test'], true)
  await runGit(repositoryRoot, ['config', 'user.email', 'sele@example.test'], true)
  return repositoryRoot
}

test('commits all staged, unstaged, and untracked changes', async () => {
  const repositoryRoot = await createRepository()

  try {
    await Promise.all([
      writeFile(join(repositoryRoot, 'staged.txt'), 'base\n'),
      writeFile(join(repositoryRoot, 'unstaged.txt'), 'base\n')
    ])
    await runGit(repositoryRoot, ['add', '.'], true)
    await runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base'], true)

    await Promise.all([
      writeFile(join(repositoryRoot, 'staged.txt'), 'staged change\n'),
      writeFile(join(repositoryRoot, 'unstaged.txt'), 'unstaged change\n'),
      writeFile(join(repositoryRoot, 'untracked.txt'), 'untracked change\n')
    ])
    await runGit(repositoryRoot, ['add', 'staged.txt'], true)

    await commitAllGitChanges({
      action: 'commit',
      message: 'commit everything',
      repositoryRoot,
      runGit
    })

    assert.deepEqual(
      (await runGit(repositoryRoot, ['show', '--format=', '--name-only', 'HEAD'], true)).split(
        '\n'
      ),
      ['staged.txt', 'unstaged.txt', 'untracked.txt']
    )
    assert.equal(await runGit(repositoryRoot, ['status', '--short'], true), '')
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test('validates a new commit message before staging changes', async () => {
  const repositoryRoot = await createRepository()

  try {
    await writeFile(join(repositoryRoot, 'untracked.txt'), 'untracked change\n')

    await assert.rejects(
      commitAllGitChanges({
        action: 'commit',
        message: '   ',
        repositoryRoot,
        runGit
      }),
      /commit message is required/i
    )

    assert.equal(await runGit(repositoryRoot, ['status', '--short'], true), '?? untracked.txt')
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test('amends HEAD with all current changes and keeps its message', async () => {
  const repositoryRoot = await createRepository()

  try {
    await writeFile(join(repositoryRoot, 'tracked.txt'), 'base\n')
    await runGit(repositoryRoot, ['add', 'tracked.txt'], true)
    await runGit(repositoryRoot, ['commit', '--quiet', '-m', 'original message'], true)

    await Promise.all([
      writeFile(join(repositoryRoot, 'tracked.txt'), 'updated\n'),
      writeFile(join(repositoryRoot, 'untracked.txt'), 'new\n')
    ])

    await commitAllGitChanges({
      action: 'amend',
      message: null,
      repositoryRoot,
      runGit
    })

    assert.equal(await runGit(repositoryRoot, ['rev-list', '--count', 'HEAD'], true), '1')
    assert.equal(
      await runGit(repositoryRoot, ['log', '-1', '--format=%s'], true),
      'original message'
    )
    assert.equal(await runGit(repositoryRoot, ['status', '--short'], true), '')
    assert.equal(await runGit(repositoryRoot, ['show', 'HEAD:tracked.txt'], true), 'updated')
    assert.equal(await runGit(repositoryRoot, ['show', 'HEAD:untracked.txt'], true), 'new')
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test('prefers process stderr and retains stdout when both contain diagnostics', () => {
  assert.equal(
    getProcessFailureMessage(
      new Error('Command failed: git commit'),
      'hook context\n',
      'fatal: useful Git error\n',
      { label: 'Git commit' }
    ),
    'fatal: useful Git error\nhook context'
  )
})

test('replaces an empty command wrapper with the exit code and operation', () => {
  const error = Object.assign(new Error('Command failed: /usr/bin/git commit'), { code: 7 })

  assert.equal(
    getProcessFailureMessage(error, '', '', { label: 'Git commit' }),
    'Git commit failed with exit code 7 without producing diagnostic output.'
  )
})

test('reports silent command timeouts explicitly', () => {
  const error = Object.assign(new Error('Command failed: /usr/bin/git fetch'), {
    code: null,
    killed: true,
    signal: 'SIGTERM'
  })

  assert.equal(
    getProcessFailureMessage(error, '', '', { label: 'Git fetch', timeoutMs: 10_000 }),
    'Git fetch timed out after 10 seconds without producing diagnostic output.'
  )
})
