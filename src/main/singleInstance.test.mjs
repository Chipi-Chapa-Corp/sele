import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { startSingleInstance, isProviderCliInvocation } from './singleInstance.ts'

const fakeApp = (ownsLock) => {
  const app = new EventEmitter()
  app.exits = []
  app.lockRequests = 0
  app.requestSingleInstanceLock = () => {
    app.lockRequests++
    return ownsLock
  }
  app.exit = (code) => app.exits.push(code)
  return app
}

test('a rejected launch exits immediately without loading the application', async () => {
  const app = fakeApp(false)
  let loads = 0
  await startSingleInstance(app, async () => {
    loads++
    throw new Error('must not load')
  }, [])
  assert.equal(loads, 0)
  assert.deepEqual(app.exits, [0])
  assert.equal(app.listenerCount('second-instance'), 0)
})

test('the owner loads once and receives subsequent launch requests', async () => {
  const app = fakeApp(true)
  let loads = 0
  let focuses = 0
  await startSingleInstance(app, async () => {
    loads++
    return { focus: () => focuses++ }
  }, [])
  app.emit('second-instance')
  app.emit('second-instance')
  assert.equal(loads, 1)
  assert.equal(focuses, 2)
  assert.deepEqual(app.exits, [])
})

test('a launch during application loading is delivered after loading finishes', async () => {
  const app = fakeApp(true)
  let finishLoading
  let focuses = 0
  const pending = startSingleInstance(
    app,
    () =>
      new Promise((resolve) => {
        finishLoading = resolve
      }),
    []
  )
  app.emit('second-instance')
  finishLoading({ focus: () => focuses++ })
  await pending
  assert.equal(focuses, 1)
})

test('provider CLI invocations exit before acquiring or loading the application', async () => {
  const app = fakeApp(true)
  let loads = 0
  await startSingleInstance(app, async () => {
    loads++
    return { focus() {} }
  }, ['app-server'])
  assert.equal(app.lockRequests, 0)
  assert.equal(loads, 0)
  assert.deepEqual(app.exits, [1])
  for (const args of [
    ['--version'],
    ['-V'],
    ['update'],
    ['--input-format', '--output-format', 'stream-json'],
    ['--headless', '--stdio']
  ]) {
    assert.equal(isProviderCliInvocation(args), true)
  }
  assert.equal(isProviderCliInvocation(['.']), false)
})

test('a failed primary load is reported and exits with an error', async () => {
  const app = fakeApp(true)
  await startSingleInstance(app, async () => {
    throw new Error('fixture load failure')
  }, [])
  assert.deepEqual(app.exits, [1])
})
