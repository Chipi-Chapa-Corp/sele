import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  createBenchmarkWorktrees,
  removeBenchmarkWorktree,
  syncBenchmarkWorktree
} from './gitBenchmark.ts'

const exec = promisify(execFile)
const git = async (cwd, args, options = {}) => {
  try {
    const { stdout } = await exec('git', args, {
      cwd,
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 5_000
    })
    return stdout.trimEnd()
  } catch (error) {
    if (options.required) throw error
    return null
  }
}

test('benchmark pairs are independent and copy and retire worktree state without touching the base', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'sele-benchmark-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const run = (folder, ...args) => git(folder, args, { required: true })
  await run(cwd, 'init', '-b', 'main')
  await run(cwd, 'config', 'user.name', 'Fixture')
  await run(cwd, 'config', 'user.email', 'fixture@localhost')
  await writeFile(join(cwd, 'tracked'), 'original\n')
  await run(cwd, 'add', '.')
  await run(cwd, 'commit', '-m', 'base')
  await writeFile(join(cwd, 'tracked'), 'dirty original\n')

  const [first, second] = await Promise.all([
    createBenchmarkWorktrees(git, cwd),
    createBenchmarkWorktrees(git, cwd)
  ])
  const primary = first.primary.worktreePath
  const secondary = first.secondary.worktreePath
  const branches = [first.primary, first.secondary, second.primary, second.secondary]
  assert.equal(new Set(branches.map(({ branchName }) => branchName)).size, 4)
  assert.equal(first.baseBranchName, 'main')
  assert.equal(await readFile(join(primary, 'tracked'), 'utf8'), 'original\n')

  await writeFile(join(secondary, 'tracked'), 'committed\n')
  await run(secondary, 'commit', '-am', 'secondary commit')
  await writeFile(join(secondary, 'tracked'), 'staged\n')
  await run(secondary, 'add', 'tracked')
  await writeFile(join(secondary, 'tracked'), 'unstaged\n')
  await writeFile(join(secondary, 'new-file'), 'untracked\n')
  await writeFile(join(primary, 'old-file'), 'losing work\n')
  await assert.rejects(
    syncBenchmarkWorktree(git, secondary, second.primary.worktreePath),
    /same benchmark/
  )
  await syncBenchmarkWorktree(git, secondary, primary)

  assert.equal(await run(primary, 'branch', '--show-current'), first.primary.branchName)
  assert.equal(await run(primary, 'rev-parse', 'HEAD'), await run(secondary, 'rev-parse', 'HEAD'))
  assert.equal(await run(primary, 'show', ':tracked'), 'staged')
  assert.equal(await readFile(join(primary, 'tracked'), 'utf8'), 'unstaged\n')
  assert.equal(await readFile(join(primary, 'new-file'), 'utf8'), 'untracked\n')
  await assert.rejects(readFile(join(primary, 'old-file')), { code: 'ENOENT' })
  assert.equal(await run(secondary, 'show', ':tracked'), 'staged')
  assert.equal(await readFile(join(cwd, 'tracked'), 'utf8'), 'dirty original\n')
  assert.equal(await run(cwd, 'branch', '--show-current'), 'main')
  assert.equal(await run(cwd, 'status', '--porcelain'), ' M tracked')
  assert.equal(await readFile(join(second.primary.worktreePath, 'tracked'), 'utf8'), 'original\n')

  await removeBenchmarkWorktree(git, cwd, secondary)
  await removeBenchmarkWorktree(git, cwd, secondary)
  await assert.rejects(readFile(join(secondary, 'tracked')), { code: 'ENOENT' })
  assert.equal(
    await run(cwd, 'rev-parse', first.secondary.branchName),
    await run(primary, 'rev-parse', 'HEAD')
  )
  const recovery = await run(
    cwd,
    'for-each-ref',
    '--format=%(refname)',
    `refs/sele/benchmark/${first.secondary.branchName.slice('agents/'.length)}/`
  )
  assert.equal(await run(cwd, 'show', `${recovery}:new-file`), 'untracked')
})
