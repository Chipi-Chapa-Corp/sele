import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
const compiled = await build({
  stdin: {
    contents: `export * from './src/renderer/src/lanPreferences';export {LanConnectionError} from './src/renderer/src/lanTransport'`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports
)
const { createLanPreferences, LanConnectionError } = module.exports
const turn = () => new Promise(setImmediate)
const setup = (store = new Map(), host = { 'sele:theme': 'light', 'sele:removed': 'old' }) => {
  const writes = []
  const listeners = new Map()
  const transport = {
    isReady: false,
    on: (name, listener) => listeners.set(name, listener),
    removeListener: () => {},
    invoke: async (_channel, request) => {
      if (request.action === 'load') return { ok: true, value: { ...host } }
      writes.push(request)
      for (const [key, value] of Object.entries(request.values)) {
        if (value === null) delete host[key]
        else host[key] = value
      }
      return { ok: true, value: null }
    }
  }
  const client = createLanPreferences({
    transport,
    initial: { ok: true, value: { ...host } },
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value)
    },
    key: 'outbox'
  })
  return { client, transport, store, host, writes, listeners }
}

test('offline edits are durable without poisoning preferences, and survive a new document', async () => {
  const first = setup()
  await first.client.initialize()
  first.client.setItem('sele:draft', 'typed offline')
  first.client.setItem('sele:theme', 'dark')
  assert.equal((await first.client.flush()).ok, true)
  assert.equal(first.writes.length, 0)
  const second = setup(first.store)
  await second.client.initialize()
  assert.equal(second.client.getItem('sele:draft').value, 'typed offline')
  second.transport.isReady = true
  await second.client.reconnect()
  assert.equal(second.host['sele:draft'], 'typed offline')
  assert.equal(second.host['sele:theme'], 'dark')
  assert.deepEqual(JSON.parse(second.store.get('outbox')), {})
  second.client.setItem('sele:draft', 'still editable')
  assert.equal((await second.client.flush()).ok, true)
  assert.equal(second.host['sele:draft'], 'still editable')
})

test('reconnection refreshes changed and removed host settings without a document reload', async () => {
  const f = setup()
  const changes = []
  await f.client.initialize()
  f.client.onChanged((change) => changes.push(change))
  f.host['sele:theme'] = 'dark'
  delete f.host['sele:removed']
  f.transport.isReady = true
  await f.client.reconnect()
  assert.equal(f.client.getItem('sele:theme').value, 'dark')
  assert.equal(f.client.getItem('sele:removed').value, null)
  assert.deepEqual(changes, [{ 'sele:theme': 'dark', 'sele:removed': null }])
})

test('an uncertain preference write is retried as values; network loss never disables drafts', async () => {
  const f = setup()
  const failures = []
  f.client.onFailure((error) => failures.push(error))
  await f.client.initialize()
  f.transport.isReady = true
  const invoke = f.transport.invoke
  let lose = true
  f.transport.invoke = async (...args) => {
    const result = await invoke(...args)
    if (lose && args[1].action === 'write') {
      lose = false
      f.transport.isReady = false
      throw new LanConnectionError('Connection lost')
    }
    return result
  }
  f.client.setItem('sele:draft', 'saved despite lost reply')
  await f.client.flush()
  assert.equal(f.client.getItem('sele:draft').value, 'saved despite lost reply')
  f.client.setItem('sele:draft', 'newer offline draft')
  await f.client.flush()
  f.transport.isReady = true
  await f.client.reconnect()
  assert.equal(f.host['sele:draft'], 'newer offline draft')
  assert.deepEqual(failures, [])
})

test('an older save echo cannot resurrect a cleared draft while synchronization is in flight', async () => {
  const f = setup()
  await f.client.initialize()
  f.transport.isReady = true
  let finish
  const invoke = f.transport.invoke
  let delay = true
  f.transport.invoke = async (...args) => {
    if (args[1].action === 'write' && delay) {
      delay = false
      await new Promise((resolve) => {
        finish = resolve
      })
      f.listeners.get('sele:preferences-changed')(undefined, args[1].values)
    }
    return invoke(...args)
  }
  f.client.setItem('sele:draft', 'attachment')
  await turn()
  f.client.removeItem('sele:draft')
  await turn()
  finish()
  await f.client.flush()
  assert.equal(f.client.getItem('sele:draft').value, null)
  assert.equal(f.host['sele:draft'], undefined)
  assert.deepEqual(JSON.parse(f.store.get('outbox')), {})
})

test('a full device store is reported instead of claiming an offline draft was saved', async () => {
  const f = setup()
  const client = createLanPreferences({
    transport: f.transport,
    initial: { ok: true, value: {} },
    key: 'outbox',
    storage: {
      getItem: () => null,
      setItem: () => {
        throw Error('Storage full')
      }
    }
  })
  await client.initialize()
  client.setItem('sele:draft', 'unsaved')
  const result = await client.flush()
  assert.equal(result.ok, false)
  assert.match(result.error, /Storage full/)
})

test('the host canonical value is delivered after an outbox save is acknowledged', async () => {
  const f = setup()
  await f.client.initialize()
  const invoke = f.transport.invoke
  f.transport.isReady = true
  f.transport.invoke = async (...args) => {
    const result = await invoke(...args)
    if (args[1].action === 'write') {
      f.host['sele:merged'] = 'canonical merged value'
      f.listeners.get('sele:preferences-changed')(undefined, {
        'sele:merged': 'canonical merged value'
      })
    }
    return result
  }
  f.client.setItem('sele:merged', 'local update')
  await f.client.flush()
  assert.equal(f.client.getItem('sele:merged').value, 'canonical merged value')
})
