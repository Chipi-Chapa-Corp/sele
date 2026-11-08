import assert from 'node:assert/strict'
import test from 'node:test'
import { createRemoteReload } from './remoteReload.ts'

const turn = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('reconnect waits for every picker/upload and durable draft storage before reloading', async () => {
  const events = []
  const saved = deferred()
  const controller = createRemoteReload({
    settle: async () => {
      events.push('render')
    },
    persist: async () => {
      events.push('persist')
      await saved.promise
    },
    reload: () => events.push('reload'),
    onError: (error) => assert.fail(String(error))
  })
  const picker = controller.hold()
  const upload = controller.hold()
  controller.request()
  controller.request()
  picker()
  picker()
  await turn()
  assert.deepEqual(events, [])
  upload()
  await turn()
  assert.deepEqual(events, ['render', 'persist'])
  saved.resolve()
  await turn()
  assert.deepEqual(events, ['render', 'persist', 'reload'])
})

test('a new attachment during persistence forces another render and save before reload', async () => {
  const events = []
  const saved = deferred()
  const controller = createRemoteReload({
    settle: async () => {
      events.push('render')
    },
    persist: async () => {
      events.push('persist')
      await saved.promise
    },
    reload: () => events.push('reload'),
    onError: (error) => assert.fail(String(error))
  })
  controller.request()
  await turn()
  const release = controller.hold()
  release()
  saved.resolve()
  await turn()
  assert.deepEqual(events, ['render', 'persist', 'render', 'persist', 'reload'])
})

test('a failed draft save preserves the current UI instead of losing the attachment', async () => {
  const failure = new Error('Unable to persist images')
  let observed
  const controller = createRemoteReload({
    settle: async () => {},
    persist: async () => {
      throw failure
    },
    reload: () => assert.fail('must not reload after a failed save'),
    onError: (error) => {
      observed = error
    }
  })
  controller.request()
  await turn()
  assert.equal(observed, failure)
})
