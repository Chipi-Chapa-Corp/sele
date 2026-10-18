import assert from 'node:assert/strict'
import test from 'node:test'
import { createPreferenceClient } from './preferenceClient.ts'

const ok = { ok: true, value: null }
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const setup = (initial = {}) => {
  const requests = []
  const commits = []
  const client = createPreferenceClient({
    initialize: async () => ({ ok: true, value: initial }),
    write: (values) => {
      const request = deferred()
      requests.push({ values, ...request })
      return request.promise
    },
    commit: (values) => {
      commits.push(values)
      return ok
    }
  })
  return { client, requests, commits }
}

test('initialization loads a snapshot; reads and edits do not wait for persistence', async () => {
  const { client, requests } = setup({ 'sele:existing': 'old' })
  assert.equal(client.getItem('sele:existing').ok, false)
  await client.initialize()
  assert.equal(client.getItem('sele:existing').value, 'old')
  assert.equal(client.setItem('sele:existing', 'new').ok, true)
  assert.equal(client.getItem('sele:existing').value, 'new')
  assert.equal(client.removeItem('sele:existing').ok, true)
  assert.equal(client.getItem('sele:existing').value, null)
  assert.equal(requests.length, 1, 'only one batch is in flight')
  const flush = client.flush()
  requests[0].resolve(ok)
  await new Promise(setImmediate)
  assert.deepEqual({ ...requests[1].values }, { 'sele:existing': null })
  requests[1].resolve(ok)
  assert.deepEqual(await flush, ok)
})

test('save bursts retain the newest values and flush includes edits during an in-flight save', async () => {
  const { client, requests } = setup()
  await client.initialize()
  client.setItem('sele:a', 'first')
  client.setItem('sele:a', 'second')
  client.setItem('sele:a', 'last')
  client.setItem('sele:b', 'other')
  const flush = client.flush()
  requests[0].resolve(ok)
  await new Promise(setImmediate)
  assert.deepEqual({ ...requests[1].values }, { 'sele:a': 'last', 'sele:b': 'other' })
  requests[1].resolve(ok)
  await flush
  client.setItem('sele:a', 'last')
  client.removeItem('sele:missing')
  assert.equal(requests.length, 2, 'unchanged values do not write')
  assert.equal(client.setItem('invalid', 'no').ok, false)
})

test('close barrier includes in-flight and unsent edits, without repeating stale values', async () => {
  const { client, requests, commits } = setup()
  await client.initialize()
  client.setItem('sele:a', 'old')
  client.setItem('sele:a', 'new')
  client.setItem('sele:b', 'saved')
  assert.deepEqual(client.commitPending(), ok)
  assert.deepEqual(commits, [{ 'sele:a': 'new', 'sele:b': 'saved' }])
  client.commitPending()
  assert.equal(commits.length, 1, 'a repeated close must not restore the old in-flight value')
  requests[0].resolve(ok)
  await client.flush()
  assert.equal(requests.length, 1, 'the barrier already saved the pending batch')
})

test('asynchronous storage failure is reported and flush cannot claim durability', async () => {
  const { client, requests } = setup()
  const errors = []
  client.onFailure((error) => errors.push(error))
  await client.initialize()
  client.setItem('sele:a', 'value')
  const flush = client.flush()
  requests[0].resolve({ ok: false, error: 'read-only database' })
  assert.equal((await flush).ok, false)
  assert.deepEqual(errors, ['read-only database'])
  assert.equal(client.getItem('sele:a').ok, false)
  assert.equal(client.setItem('sele:b', 'no').ok, false)
  assert.equal(client.commitPending().ok, false)
})

test('rejected transport promises are handled and initialization failure preserves storage', async () => {
  let reported = ''
  const client = createPreferenceClient({
    initialize: async () => ({ ok: true, value: {} }),
    write: async () => {
      throw new Error('IPC unavailable')
    },
    commit: () => ok
  })
  client.onFailure((error) => {
    reported = error
  })
  await client.initialize()
  client.setItem('sele:a', 'value')
  assert.equal((await client.flush()).ok, false)
  assert.equal(reported, 'IPC unavailable')
  const failed = createPreferenceClient({
    initialize: async () => ({ ok: false, error: 'corrupt database' }),
    write: () => assert.fail('must not write after failed initialization'),
    commit: () => assert.fail('must not commit after failed initialization')
  })
  assert.equal((await failed.initialize()).ok, false)
  assert.equal(failed.setItem('sele:a', 'reset').ok, false)
})
