import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { getFileTargetGitCwd, resolveFileTargetPath } from './fileTarget.ts'

const execFileAsync = promisify(execFile)

test('an absolute file target is independent of the selected repository', () => {
  const path = resolveFileTargetPath(
    '/home/example/selected-project',
    '/tmp/other-project/src/file.ts',
    '/home/example/selected-project'
  )

  assert.equal(path, '/tmp/other-project/src/file.ts')
  assert.equal(getFileTargetGitCwd(path), '/tmp/other-project/src')
})

test('a relative file target remains relative to the selected repository root', () => {
  assert.equal(
    resolveFileTargetPath(
      '/home/example/project/packages/app',
      'src/file.ts',
      '/home/example/project'
    ),
    '/home/example/project/src/file.ts'
  )
})

test('a relative non-Git file target falls back to the selected cwd', () => {
  assert.equal(
    resolveFileTargetPath('/home/example/files', 'notes/today.txt', null),
    '/home/example/files/notes/today.txt'
  )
})

test('discovers Git from an absolute file target instead of the selected repository', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'sele-file-target-'))
  const selectedRepository = join(fixtureRoot, 'selected')
  const targetRepository = join(fixtureRoot, 'target')
  const targetDirectory = join(targetRepository, 'src')

  try {
    await Promise.all([
      mkdir(selectedRepository, { recursive: true }),
      mkdir(targetDirectory, { recursive: true })
    ])
    await Promise.all([
      execFileAsync('git', ['init', '--quiet', selectedRepository]),
      execFileAsync('git', ['init', '--quiet', targetRepository])
    ])

    const targetPath = resolveFileTargetPath(
      selectedRepository,
      join(targetDirectory, 'file.ts'),
      selectedRepository
    )
    const { stdout } = await execFileAsync('git', [
      '-C',
      getFileTargetGitCwd(targetPath),
      'rev-parse',
      '--show-toplevel'
    ])

    assert.equal(stdout.trim(), targetRepository)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
