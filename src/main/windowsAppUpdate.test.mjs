import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { cleanInstalledWindowsUpdate } from './windowsAppUpdate.ts'

async function fixture(t, downloaded) {
  const root = await mkdtemp(join(tmpdir(), 'sele-windows-update-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cache = join(root, 'sele-updater')
  const pending = join(cache, 'pending')
  const fileName = 'sele-windows-x64-setup.exe'
  const sha512 = createHash('sha512').update(downloaded).digest('base64')
  await mkdir(pending, { recursive: true })
  await writeFile(join(cache, 'installer.exe'), 'installed-a')
  await writeFile(join(cache, 'current.blockmap'), 'differential download metadata')
  await writeFile(join(pending, fileName), downloaded)
  await writeFile(join(pending, 'update-info.json'), JSON.stringify({ fileName, sha512 }))
  return { root, cache, pending, fileName }
}

test('startup clears an already installed download and keeps the differential installer', async (t) => {
  const { root, cache } = await fixture(t, 'installed-a')
  await cleanInstalledWindowsUpdate(root)
  await cleanInstalledWindowsUpdate(root)
  assert.deepEqual((await readdir(cache)).sort(), ['current.blockmap', 'installer.exe'])
  assert.equal(await readFile(join(cache, 'installer.exe'), 'utf8'), 'installed-a')
})

test('startup keeps an unapplied download, even when it is the same size as the installed one', async (t) => {
  const { root, pending, fileName } = await fixture(t, 'installed-b')
  await cleanInstalledWindowsUpdate(root)
  assert.deepEqual((await readdir(pending)).sort(), [fileName, 'update-info.json'].sort())
  assert.equal(await readFile(join(pending, fileName), 'utf8'), 'installed-b')
})
