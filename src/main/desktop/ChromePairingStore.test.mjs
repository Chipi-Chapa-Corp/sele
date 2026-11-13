import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { EncryptedChromePairingStore } from './ChromePairingStore.ts'

test('pairing is stored encrypted with private permissions and corruption fails clearly', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sele-pairing-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'chrome', 'pairing.json')
  const key = randomBytes(32)
  const cipher = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([c.update(value, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), encrypted])
    },
    decryptString(value) {
      const c = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      c.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([c.update(value.subarray(28)), c.final()]).toString()
    }
  }
  const store = new EncryptedChromePairingStore(
    () => path,
    async () => cipher
  )
  assert.equal(await store.load(), null)
  const value = { port: 12345, token: randomBytes(32).toString('base64url') }
  await store.save(value)
  assert.deepEqual(await store.load(), value)
  assert.equal((await readFile(path, 'utf8')).includes(value.token), false)
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
  await assert.rejects(store.save({ ...value, port: 0 }), /Invalid saved/)
  const unavailable = new EncryptedChromePairingStore(
    () => path,
    async () => ({ ...cipher, isEncryptionAvailable: () => false })
  )
  await assert.rejects(unavailable.load(), /unavailable/)
  await assert.rejects(unavailable.save(value), /unavailable/)
  const insecure = new EncryptedChromePairingStore(
    () => path,
    async () => ({ ...cipher, getSelectedStorageBackend: () => 'basic_text' })
  )
  await assert.rejects(insecure.save(value), /OS secret store/)
  await assert.rejects(insecure.load(), /OS secret store/)
  await writeFile(path, '{"version":1,"encrypted":"aaaa"}')
  await assert.rejects(store.load())
  await store.clear()
  assert.equal(await store.load(), null)
})
