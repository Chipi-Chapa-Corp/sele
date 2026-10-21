import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AccountDisplayNameCache } from './AccountDisplayNameCache.ts'

test('names survive restart and transient profile failures without crossing provider or environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sele-account-name-cache-'))
  const path = () => join(root, 'names.json')
  const configuration = (displayName) => ({
    available: true,
    unavailableMessage: null,
    accounts: [
      { id: 'default', displayName, active: true },
      { id: 'inactive', displayName: 'Inactive Name', active: false }
    ]
  })
  try {
    await new AccountDisplayNameCache(path).merge('claude:host', configuration('Personal Name'))
    const cache = new AccountDisplayNameCache(path)
    const cached = await cache.merge('claude:host', configuration(null))
    assert.equal(cached.accounts[0].displayName, 'Personal Name')
    assert.equal(cached.accounts[1].displayName, 'Inactive Name')
    assert.equal(
      (await cache.merge('claude:remote', configuration(null))).accounts[0].displayName,
      null
    )
    assert.equal(
      (await cache.merge('codex:host', configuration(null))).accounts[0].displayName,
      null
    )
    await cache.merge('claude:host', configuration('Updated Name'))
    assert.equal(
      (await new AccountDisplayNameCache(path).merge('claude:host', configuration(null)))
        .accounts[0].displayName,
      'Updated Name'
    )
    assert.equal('name' in JSON.parse(await readFile(path(), 'utf8'))['claude:host'], false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
