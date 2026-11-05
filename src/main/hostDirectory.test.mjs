import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import test from 'node:test'
import { browseHostDirectory } from './hostDirectory.ts'

test('approved clients can browse a folder, including hidden files and linked directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-host-picker-'))
  try {
    await mkdir(join(root, 'projects'))
    await mkdir(join(root, '.ssh'))
    await writeFile(join(root, 'README.md'), 'test')
    await symlink(join(root, 'projects'), join(root, 'linked'))
    await symlink(join(root, 'missing'), join(root, 'broken'))
    const listing = await browseHostDirectory(root)
    assert.equal(listing.path, root)
    assert.equal(listing.parent, dirname(root))
    assert.equal(listing.truncated, false)
    assert.equal(listing.entries.find((entry) => entry.name === '.ssh').directory, true)
    assert.equal(listing.entries.find((entry) => entry.name === 'linked').directory, true)
    assert.equal(listing.entries.find((entry) => entry.name === 'README.md').directory, false)
    assert.equal(listing.entries.find((entry) => entry.name === 'broken').directory, false)
    assert.equal((await browseHostDirectory('~')).path, homedir())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('host picker rejects invalid or relative paths and reports unavailable folders', async () => {
  for (const value of [null, {}, 2, 'relative/path', '/tmp/invalid\0path', 'x'.repeat(4097)])
    await assert.rejects(browseHostDirectory(value))
  await assert.rejects(browseHostDirectory('/sele-missing-folder-' + Date.now()))
})
