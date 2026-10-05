import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { parseTargetFileTree, readLocalFileTree, targetFileTreeScript } from './fileTree.ts'
import { getFileTreeAbsolutePath } from '../shared/fileTree.ts'

const exec = promisify(execFile)
const fixture = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'hello world.txt'), 'hello')
  await writeFile(join(root, '.hidden'), 'hidden')
  await writeFile(join(root, '.gitignore'), '*.log')
  await writeFile(join(root, 'ignored.log'), 'still a file')
  await writeFile(join(root, 'line\nbreak.txt'), 'newline')
  return root
}
const targetTree = async (root) => {
  const { stdout } = await exec('sh', ['-c', targetFileTreeScript, 'sele-list-files', root], {
    encoding: 'buffer'
  })
  return parseTargetFileTree(stdout)
}

test('ordinary folders list hidden and ignored files with no Git repository', async (t) => {
  const root = await fixture(t)
  const result = await readLocalFileTree(root)
  assert.equal(result.repositoryRoot, root)
  assert.equal(result.branchName, null)
  assert.deepEqual(result.files.map((file) => file.path).sort(), [
    '.gitignore',
    '.hidden',
    'ignored.log',
    'line\nbreak.txt',
    'src/hello world.txt'
  ])
  assert.deepEqual(await targetTree(root), result)
})

test('Git metadata and symlink cycles cannot affect listing; nested folders keep their own root', async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, '.git'))
  await writeFile(join(root, '.git', 'broken metadata'), 'not a repository')
  await symlink(root, join(root, 'src', 'loop'), 'dir')
  await symlink('missing-target', join(root, 'broken-link'))
  const result = await readLocalFileTree(root)
  assert.ok(result.files.some((file) => file.path === 'src/loop'))
  assert.ok(result.files.some((file) => file.path === 'broken-link'))
  assert.ok(!result.files.some((file) => file.path.startsWith('.git/')))
  assert.deepEqual(await targetTree(root), result)
  const nested = await readLocalFileTree(join(root, 'src'))
  assert.equal(nested.repositoryRoot, join(root, 'src'))
  assert.equal(
    getFileTreeAbsolutePath(nested.repositoryRoot, 'hello world.txt'),
    join(root, 'src', 'hello world.txt')
  )
  assert.deepEqual(await targetTree(join(root, 'src')), nested)
})

test('missing folders and non-directories preserve the actual error and path', async (t) => {
  const root = await fixture(t)
  const missing = join(root, 'missing')
  await assert.rejects(
    readLocalFileTree(missing),
    (error) => error.code === 'ENOENT' && error.path === missing
  )
  await assert.rejects(readLocalFileTree(join(root, '.hidden')), { code: 'ENOTDIR' })
  await assert.rejects(targetTree(missing), (error) => error.stderr.toString().includes(missing))
})

test('unreadable subdirectories report a failure rather than a successful partial listing', {
  skip: process.platform === 'win32' || process.getuid?.() === 0
}, async (t) => {
  const root = await fixture(t)
  const denied = join(root, 'denied')
  await mkdir(denied)
  await chmod(denied, 0)
  try {
    await assert.rejects(
      readLocalFileTree(root),
      (error) => error.code === 'EACCES' && error.path === denied
    )
    await assert.rejects(targetTree(root), (error) => error.stderr.toString().includes('denied'))
  } finally {
    await chmod(denied, 0o700)
  }
})

test('empty folders and root path joining are supported', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sele-empty-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual((await readLocalFileTree(root)).files, [])
  assert.deepEqual(await targetTree(root), await readLocalFileTree(root))
  assert.equal(getFileTreeAbsolutePath('/', 'a.txt'), '/a.txt')
  assert.equal(getFileTreeAbsolutePath('C:\\project\\', 'src/a.txt'), 'C:\\project/src/a.txt')
})
