import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { request } from 'node:https'
import test from 'node:test'
import { loadLocalAccessTls } from './localAccessTls.ts'
import { localAccessPairingCode } from '../shared/localAccess.ts'

test('pairing approval code binds both the verified computer and this request credential', async () => {
  const fingerprint = 'a'.repeat(64)
  const token = 'b'.repeat(64)
  const code = await localAccessPairingCode(fingerprint, token)
  assert.match(code, /^[A-F0-9]{4} [A-F0-9]{4} [A-F0-9]{4}$/)
  assert.equal(await localAccessPairingCode(fingerprint, token), code)
  assert.notEqual(
    await localAccessPairingCode(fingerprint, 'c'.repeat(64)),
    code,
    'another pending request must have a different code'
  )
  assert.notEqual(
    await localAccessPairingCode('c'.repeat(64), token),
    code,
    'a relay with another TLS certificate must have a different code'
  )
  await assert.rejects(localAccessPairingCode(fingerprint, undefined), /Invalid pairing identity/)
})

test('computer TLS identity is persistent, private, and not silently replaced after corruption', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-identity-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'identity.json')
  const first = await loadLocalAccessTls(path)
  assert.deepEqual(await loadLocalAccessTls(path), first)
  assert.equal(
    first.fingerprint,
    new X509Certificate(first.cert).fingerprint256.replaceAll(':', '').toLowerCase()
  )
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
  await writeFile(path, '{broken identity')
  await assert.rejects(loadLocalAccessTls(path))
  assert.equal(await readFile(path, 'utf8'), '{broken identity')
})

test('concurrent startup cannot replace the computer identity', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-identity-race-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'identity.json')
  const identities = await Promise.all(Array.from({ length: 3 }, () => loadLocalAccessTls(path)))
  for (const identity of identities) assert.deepEqual(identity, identities[0])
  assert.deepEqual(await loadLocalAccessTls(path), identities[0])
})

test('a certificate from another computer fails ordinary TLS verification', async (t) => {
  const { createServer } = await import('node:https')
  const directory = await mkdtemp(join(tmpdir(), 'sele-substitute-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const trusted = await loadLocalAccessTls(join(directory, 'trusted.json'))
  const substituted = await loadLocalAccessTls(join(directory, 'substituted.json'))
  let reached = false
  const server = createServer({ ...substituted, minVersion: 'TLSv1.2' }, (_request, response) => {
    reached = true
    response.end('unexpected')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  await assert.rejects(
    new Promise((resolve, reject) => {
      request(`https://127.0.0.1:${server.address().port}/`, { ca: trusted.cert }, resolve)
        .on('error', reject)
        .end()
    }),
    /self.signed|certificate/i
  )
  assert.equal(reached, false)
})
