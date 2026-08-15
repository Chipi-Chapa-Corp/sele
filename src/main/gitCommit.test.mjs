import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { commitGitFileChanges } from './gitCommit.ts'
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

test('reports a stale file selection without exposing a raw Git command failure', async () => {
  const repositoryRoot = await createRepository()

  try {
    await writeFile(join(repositoryRoot, 'tracked.txt'), 'base\n')
    await runGit(repositoryRoot, ['add', 'tracked.txt'], true)
    await runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base'], true)
    const headBefore = await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true)

    await assert.rejects(
      commitGitFileChanges({
        action: 'commit',
        files: ['missing-workflow.yml'],
        message: 'stale change',
        repositoryRoot,
        runGit
      }),
      /selected files no longer contain uncommitted changes/i
    )

    assert.equal(await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true), headBefore)
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test('does not touch the real index when a staged new file disappears', async () => {
  const repositoryRoot = await createRepository()

  try {
    await writeFile(join(repositoryRoot, 'tracked.txt'), 'base\n')
    await runGit(repositoryRoot, ['add', 'tracked.txt'], true)
    await runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base'], true)

    const vanishedPath = join(repositoryRoot, 'vanished.txt')
    await writeFile(vanishedPath, 'temporary\n')
    await runGit(repositoryRoot, ['add', 'vanished.txt'], true)
    await rm(vanishedPath)
    const statusBefore = await runGit(repositoryRoot, ['status', '--short'], true)

    await assert.rejects(
      commitGitFileChanges({
        action: 'commit',
        files: ['vanished.txt'],
        message: 'stale staged change',
        repositoryRoot,
        runGit
      }),
      /selected files no longer contain uncommitted changes/i
    )

    assert.equal(await runGit(repositoryRoot, ['status', '--short'], true), statusBefore)
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test('commits selected files while preserving unrelated staged changes', async () => {
  const repositoryRoot = await createRepository()

  try {
    await Promise.all([
      writeFile(join(repositoryRoot, 'selected.txt'), 'base\n'),
      writeFile(join(repositoryRoot, 'unrelated.txt'), 'base\n')
    ])
    await runGit(repositoryRoot, ['add', '.'], true)
    await runGit(repositoryRoot, ['commit', '--quiet', '-m', 'base'], true)

    await Promise.all([
      writeFile(join(repositoryRoot, 'selected.txt'), 'selected change\n'),
      writeFile(join(repositoryRoot, 'unrelated.txt'), 'unrelated change\n')
    ])
    await runGit(repositoryRoot, ['add', 'unrelated.txt'], true)

    await commitGitFileChanges({
      action: 'commit',
      files: ['selected.txt'],
      message: 'commit selected file',
      repositoryRoot,
      runGit
    })

    assert.equal(
      await runGit(repositoryRoot, ['show', '--format=', '--name-only', 'HEAD'], true),
      'selected.txt'
    )
    assert.equal(
      await runGit(repositoryRoot, ['diff', '--cached', '--name-only'], true),
      'unrelated.txt'
    )
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
