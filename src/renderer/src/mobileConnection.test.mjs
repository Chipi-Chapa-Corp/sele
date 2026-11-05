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

test('Android connection links select the LAN host independently of the packaged app origin', () => {
  const connection = parseMobileConnection(`http://192.168.1.20:4589/#token=${token}`)
  assert.deepEqual(connection, { origin: 'http://192.168.1.20:4589', token })
  assert.equal(mobileWebSocketUrl(connection), 'ws://192.168.1.20:4589/sele/ws')
  assert.equal(
    mobileWebSocketUrl(parseMobileConnection(`https://workstation.local/#token=${token}`)),
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
    assert.ok(parseMobileConnection(`http://${hostname}:4589/#token=${token}`))
  }
})

test('connection setup rejects missing keys, external hosts, credentials and unrelated URLs', () => {
  for (const link of [
    token,
    'http://192.168.1.20:4589/',
    `http://192.168.1.20:4589/#token=bad`,
    `https://example.com/#token=${token}`,
    `http://8.8.8.8/#token=${token}`,
    `http://172.32.0.1/#token=${token}`,
    `http://user:password@192.168.1.20/#token=${token}`,
    `file:///tmp/index.html#token=${token}`,
    `http://192.168.1.20/admin#token=${token}`,
    `http://192.168.1.20/?redirect=x#token=${token}`
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
  const connection = parseMobileConnection(`http://10.0.0.5:4589/#token=${token}`)
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
