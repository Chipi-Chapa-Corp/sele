import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareCodexShadowHome, resolveCodexAccount } from './CodexShadowHome.ts'

const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const fixture = async (t) => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'sele-shadow-')))
  t.after(() => rm(home, { recursive: true, force: true }))
  for (const id of [a, b]) {
    await mkdir(join(home, 'sele/accounts', id), { recursive: true })
    await writeFile(join(home, 'sele/accounts', id, 'auth.json'), id)
  }
  return home
}

test('accounts share history, config, memories and locks while auth and models stay private', async (t) => {
  const home = await fixture(t)
  await writeFile(join(home, 'auth.json'), 'default')
  await writeFile(join(home, 'models_cache.json'), 'default models')
  const first = await prepareCodexShadowHome(home, a)
  const second = await prepareCodexShadowHome(home, b)
  await writeFile(join(first, 'sessions', 'fixture'), 'history')
  await writeFile(join(first, 'thread-writer-locks', 'fixture.lock'), 'writer')
  await writeFile(join(first, 'auth.json'), 'rotated by harness')
  await writeFile(join(first, 'models_cache.json'), 'personal models')
  assert.equal(await readFile(join(second, 'sessions', 'fixture'), 'utf8'), 'history')
  assert.equal(
    await readFile(join(second, 'thread-writer-locks', 'fixture.lock'), 'utf8'),
    'writer'
  )
  assert.equal(await readFile(join(home, 'auth.json'), 'utf8'), 'default')
  assert.equal(await readFile(join(second, 'auth.json'), 'utf8'), b)
  assert.equal(await readFile(join(home, 'models_cache.json'), 'utf8'), 'default models')
  assert.equal(await realpath(join(first, 'memories')), join(home, 'memories'))
  await assert.rejects(realpath(join(first, 'sele')), { code: 'ENOENT' })
  await prepareCodexShadowHome(home, a)
  await Promise.all([prepareCodexShadowHome(home, a), prepareCodexShadowHome(home, a)])
  await rm(first, { recursive: true })
  assert.equal(await readFile(join(home, 'sessions', 'fixture'), 'utf8'), 'history')
})

test('missing or linked credentials and copied state fail without overwriting either account', async (t) => {
  const home = await fixture(t)
  const shadow = join(home, 'sele/accounts', a)
  await writeFile(join(shadow, 'config.toml'), 'keep me')
  await assert.rejects(prepareCodexShadowHome(home, a), /conflicting entry/)
  assert.equal(await readFile(join(shadow, 'config.toml'), 'utf8'), 'keep me')
  await rm(join(shadow, 'config.toml'))
  await rm(join(shadow, 'auth.json'))
  await assert.rejects(prepareCodexShadowHome(home, a), /no longer available/)
  await symlink(join(home, 'sele/accounts', b, 'auth.json'), join(shadow, 'auth.json'))
  await assert.rejects(prepareCodexShadowHome(home, a), /no longer available/)
  await assert.rejects(resolveCodexAccount(home, '../escape'), /Invalid Codex account/)
})

test('pinned default and account selections ignore a changed global default', async (t) => {
  const home = await fixture(t)
  await writeFile(join(home, 'sele/active-account'), a)
  assert.equal(await resolveCodexAccount(home), a)
  assert.equal(await resolveCodexAccount(home, 'default'), 'default')
  assert.equal(await resolveCodexAccount(home, b), b)
  await writeFile(join(home, 'sele/active-account'), '../escape')
  await assert.rejects(resolveCodexAccount(home), /Invalid/)
})
