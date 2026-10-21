import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getOpenCodeAdminConnectionId,
  isOpenCodeAdminKey,
  OpenCodeAdminKeyStore,
  parseOpenCodeAdminConnectionId,
  supportsOpenCodeAdminKey
} from './OpenCodeAdminKeys.ts'

const fakeCrypto = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from(`enc:${value}`),
  decryptString: (value) => {
    const text = value.toString()
    if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
    return text.slice(4)
  }
})

const withStore = async (crypto, run) => {
  const dir = await mkdtemp(join(tmpdir(), 'sele-admin-keys-'))
  const path = join(dir, 'nested', 'opencode-admin-keys.json')
  try {
    await run(
      new OpenCodeAdminKeyStore(
        async () => path,
        async () => crypto
      ),
      path
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('recognizes admin key formats only for their provider', () => {
  assert.equal(isOpenCodeAdminKey('anthropic', 'sk-ant-admin01-abc'), true)
  assert.equal(isOpenCodeAdminKey('anthropic', 'sk-ant-api03-abc'), false)
  assert.equal(isOpenCodeAdminKey('openai', ' sk-admin-abc'), true)
  assert.equal(isOpenCodeAdminKey('openai', 'sk-proj-abc'), false)
  // OpenRouter management keys share the inference prefix, so they are only chosen explicitly.
  assert.equal(isOpenCodeAdminKey('openrouter', 'sk-or-v1-abc'), false)
  assert.equal(isOpenCodeAdminKey('deepseek', 'sk-admin-abc'), false)
  assert.equal(supportsOpenCodeAdminKey('openrouter'), true)
  assert.equal(supportsOpenCodeAdminKey('toString'), false)
})

test('admin connection IDs round-trip and never collide with OpenCode providers', () => {
  assert.equal(parseOpenCodeAdminConnectionId(getOpenCodeAdminConnectionId('openai')), 'openai')
  assert.equal(parseOpenCodeAdminConnectionId('openai'), null)
  assert.equal(parseOpenCodeAdminConnectionId('sele-admin:'), null)
})

test('stores keys encrypted with owner-only permissions', async () => {
  await withStore(fakeCrypto(), async (store, path) => {
    assert.deepEqual(await store.list(), {})
    await store.set('anthropic', 'sk-ant-admin01-secret')
    await store.set('openai', 'sk-admin-secret')
    const content = await readFile(path, 'utf8')
    assert.equal(content.includes('secret'), false)
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.deepEqual(await store.list(), {
      anthropic: 'sk-ant-admin01-secret',
      openai: 'sk-admin-secret'
    })
    await store.remove('anthropic')
    await store.remove('missing')
    assert.deepEqual(await store.list(), { openai: 'sk-admin-secret' })
  })
})

test('falls back to an owner-only plain file without OS encryption', async () => {
  await withStore(fakeCrypto(false), async (store, path) => {
    await store.set('openrouter', 'mgmt-key')
    assert.match(await readFile(path, 'utf8'), /"plain"/)
    assert.deepEqual(await store.list(), { openrouter: 'mgmt-key' })
  })
})

test('skips undecryptable entries and tolerates a corrupt file', async () => {
  await withStore(fakeCrypto(), async (store, path) => {
    await store.set('openai', 'sk-admin-ok')
    const stored = JSON.parse(await readFile(path, 'utf8'))
    stored.keys.anthropic = {
      encoding: 'safeStorage',
      value: Buffer.from('garbage').toString('base64')
    }
    await writeFile(path, JSON.stringify(stored))
    assert.deepEqual(await store.list(), { openai: 'sk-admin-ok' })
    await writeFile(path, '{not json')
    assert.deepEqual(await store.list(), {})
  })
})

test('concurrent writes keep every key', async () => {
  await withStore(fakeCrypto(), async (store) => {
    await Promise.all([
      store.set('anthropic', 'a'),
      store.set('openai', 'b'),
      store.set('openrouter', 'c')
    ])
    assert.deepEqual(await store.list(), { anthropic: 'a', openai: 'b', openrouter: 'c' })
  })
})
