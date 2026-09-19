import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, unlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { stageGitFileDiffPaths } from './gitFileDiff.ts'

const execFileAsync = promisify(execFile)
const git = async (cwd, args, options = {}) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8'
  })
  return stdout
}
const runner = (cwd, args, options) => git(cwd, args, options)

const createRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-git-file-diff-test-'))
  await git(root, ['init', '-q'])
  await git(root, ['config', 'user.email', 'sele@example.test'])
  await git(root, ['config', 'user.name', 'Sele Test'])
  return root
}

test('file diff staging does not invoke an unrelated slow clean filter', async (t) => {
  const root = await createRepository()
  t.after(() => rm(root, { recursive: true, force: true }))
  const marker = join(root, 'filter-ran')
  const filter = join(root, 'slow-filter.sh')
  await writeFile(filter, `#!/bin/sh\nprintf ran > "${marker}"\nsleep 2\ncat\n`, 'utf8')
  await chmod(filter, 0o755)
  await writeFile(join(root, '.gitattributes'), 't.txt filter=slow\n')
  await writeFile(join(root, 't.txt'), 'initial slow\n')
  await writeFile(join(root, '[target].txt'), 'initial target\n')
  await git(root, ['config', 'filter.slow.clean', filter])
  await git(root, ['config', 'filter.slow.required', 'true'])
  await git(root, ['add', '.'])
  await git(root, ['commit', '-qm', 'initial'])
  await rm(marker, { force: true })
  await writeFile(join(root, 't.txt'), 'changed slow\n')
  await writeFile(join(root, '[target].txt'), 'changed target\n')

  const temp = join(root, 'temporary-index')
  await git(root, ['read-tree', 'HEAD'], { env: { GIT_INDEX_FILE: temp } })
  await stageGitFileDiffPaths(root, temp, ['[target].txt'], runner)

  await assert.rejects(readFile(marker), { code: 'ENOENT' })
  assert.equal(
    await git(root, ['diff', '--cached', '--name-only'], { env: { GIT_INDEX_FILE: temp } }),
    '[target].txt\n'
  )
  assert.equal(await git(root, ['diff', '--cached', '--name-only']), '')
})

test('file diff staging accepts renames, deletions, untracked paths, and absent previous paths', async (t) => {
  const root = await createRepository()
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'old.txt'), 'rename me\n')
  await writeFile(join(root, 'deleted.txt'), 'delete me\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '-qm', 'initial'])
  await rename(join(root, 'old.txt'), join(root, 'renamed.txt'))
  await unlink(join(root, 'deleted.txt'))
  await writeFile(join(root, 'nested', 'untracked.txt'), 'new\n')

  const temp = join(root, 'temporary-index')
  await git(root, ['read-tree', 'HEAD'], { env: { GIT_INDEX_FILE: temp } })
  await stageGitFileDiffPaths(
    root,
    temp,
    ['renamed.txt', 'old.txt', 'deleted.txt', 'nested/untracked.txt', 'missing.txt'],
    runner
  )

  const changed = (
    await git(root, ['diff', '--cached', '--name-only', '--no-renames'], {
      env: { GIT_INDEX_FILE: temp }
    })
  )
    .trim()
    .split('\n')
  assert.deepEqual(changed.sort(), [
    'deleted.txt',
    'nested/untracked.txt',
    'old.txt',
    'renamed.txt'
  ])
})
