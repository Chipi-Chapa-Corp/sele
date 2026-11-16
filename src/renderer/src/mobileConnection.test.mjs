import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalPreferences } from './localPreferences.ts'
import {
  parseMobileConnection,
  mobileConnectionLink,
  mobileWebSocketUrl,
  readMobileConnection,
  saveMobileConnection
} from './mobileConnection.ts'

const token = 'a'.repeat(64)
const fingerprint = 'c'.repeat(64)

test('Android connection links select the LAN host independently of the packaged app origin', () => {
  const connection = parseMobileConnection(
    `https://192.168.1.20:4589/#token=${token}&fingerprint=${fingerprint}`
  )
  assert.deepEqual(connection, { origin: 'https://192.168.1.20:4589', token, fingerprint })
  assert.equal(mobileWebSocketUrl(connection), 'wss://192.168.1.20:4589/sele/ws')
  assert.equal(
    mobileWebSocketUrl(
      parseMobileConnection(`https://workstation.local/#token=${token}&fingerprint=${fingerprint}`)
    ),
    'wss://workstation.local/sele/ws'
  )
  for (const hostname of [
    '10.0.2.2',
    '172.16.0.2',
    '172.31.255.254',
    '127.0.0.1',
    'desktop.local',
    '[fd00::1]'
  ]) {
    assert.ok(
      parseMobileConnection(`https://${hostname}:4589/#token=${token}&fingerprint=${fingerprint}`)
    )
  }
})

test('connection setup rejects missing keys, external hosts, credentials and unrelated URLs', () => {
  for (const link of [
    token,
    `http://192.168.1.20:4589/#token=${token}&fingerprint=${fingerprint}`,
    `https://192.168.1.20:4589/#token=${token}`,
    'https://192.168.1.20:4589/',
    `https://192.168.1.20:4589/#token=bad`,
    `https://example.com/#token=${token}&fingerprint=${fingerprint}`,
    `https://8.8.8.8/#token=${token}&fingerprint=${fingerprint}`,
    `https://172.32.0.1/#token=${token}&fingerprint=${fingerprint}`,
    `https://user:password@192.168.1.20/#token=${token}&fingerprint=${fingerprint}`,
    `file:///tmp/index.html#token=${token}&fingerprint=${fingerprint}`,
    `https://192.168.1.20/admin#token=${token}&fingerprint=${fingerprint}`,
    `https://192.168.1.20/?redirect=x#token=${token}&fingerprint=${fingerprint}`
  ]) {
    assert.throws(() => parseMobileConnection(link), undefined, link)
  }
})

test('host selection survives app restart and invalid saved values require a new link', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
  assert.equal(readMobileConnection(storage), null)
  const connection = parseMobileConnection(
    `https://10.0.0.5:4589/#token=${token}&fingerprint=${fingerprint}`
  )
  saveMobileConnection(connection, storage)
  assert.deepEqual(readMobileConnection(storage), connection)
  assert.deepEqual(
    parseMobileConnection(mobileConnectionLink(readMobileConnection(storage))),
    connection
  )
  const key = [...values.keys()][0]
  values.set(key, 'invalid JSON')
  assert.equal(readMobileConnection(storage), null)
  values.set(key, JSON.stringify({ origin: 'https://example.com', token }))
  assert.equal(readMobileConnection(storage), null)
})

test('Android drafts and UI preferences stay separate for different Sele hosts', async () => {
  const values = new Map()
  const storage = {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const first = createLocalPreferences(storage, 'host:first:')
  const second = createLocalPreferences(storage, 'host:second:')
  first.setItem('sele:draft', 'private draft for the first computer')
  assert.equal(second.getItem('sele:draft').value, null)
  second.setItem('sele:draft', 'draft for the second computer')
  assert.equal(first.getItem('sele:draft').value, 'private draft for the first computer')
  assert.deepEqual((await first.initialize()).value, {
    'sele:draft': 'private draft for the first computer'
  })
})

test('saved devices retain their credentials and follow stable identity across address changes', async () => {
  const { readMobileDevices, mobileConnectionStorageKey } = await import('./mobileConnection.ts')
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
  const first = {
    origin: 'https://192.168.1.2:4589',
    token,
    fingerprint,
    hostId: '11111111-1111-1111-1111-111111111111',
    name: 'Desktop'
  }
  const second = {
    origin: 'https://192.168.1.3:4589',
    token: 'b'.repeat(64),
    fingerprint,
    hostId: '22222222-2222-2222-2222-222222222222',
    name: 'Laptop'
  }
  saveMobileConnection(first, storage)
  saveMobileConnection(second, storage)
  assert.deepEqual(readMobileDevices(storage), [second, first])
  const moved = { ...first, origin: 'https://192.168.1.50:4589' }
  saveMobileConnection(moved, storage)
  assert.deepEqual(readMobileDevices(storage), [moved, second])
  values.delete(mobileConnectionStorageKey)
  assert.equal(readMobileConnection(storage), null, 'choosing devices does not auto-select one')
  assert.deepEqual(readMobileDevices(storage), [moved, second], 'choosing devices keeps approvals')
})
