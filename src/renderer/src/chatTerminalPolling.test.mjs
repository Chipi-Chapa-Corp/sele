import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatTerminalActivity } from './chatTerminalActivity.ts'
import { createChatTerminalPoller } from './chatTerminalPolling.ts'

const fixture = (options = {}) => {
  const activity = createChatTerminalActivity()
  const key = 'opencode:chat'
  activity.setIdle(key, true)
  const errors = []
  let tasks = ['shell']
  let reads = 0
  let time = 0
  const poller = createChatTerminalPoller({
    now: () => time,
    getChats: () => [{ id: 'chat', providerId: 'opencode', status: null }],
    readTasks: async () => {
      reads++
      if (tasks instanceof Error) throw tasks
      return typeof tasks === 'function' ? tasks() : tasks
    },
    activity,
    onError: (error) => errors.push(error),
    ...options
  })
  return {
    activity,
    key,
    errors,
    poller,
    reads: () => reads,
    advance: (ms) => {
      time += ms
    },
    setTasks: (value) => {
      tasks = value
    }
  }
}

test('connection loss clears the running claim without a completion notification, then retries idle chats', async () => {
  const f = fixture()
  await f.poller.poll()
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: true, unread: false })
  f.setTasks(new Error('server disconnected'))
  await f.poller.poll()
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: false, unread: false })
  assert.equal(f.errors.length, 1)
  f.setTasks([])
  f.advance(1000)
  await f.poller.poll()
  assert.equal(f.reads(), 3)
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: false, unread: false })
  await f.poller.poll()
  assert.equal(f.reads(), 3, 'successfully discovered idle chats no longer need polling')
})

test('failed initial discovery retries and verified task completion still marks unread', async () => {
  const f = fixture()
  f.setTasks(new Error('temporarily offline'))
  await f.poller.poll()
  f.setTasks(['shell'])
  f.advance(1000)
  await f.poller.poll()
  assert.equal(f.activity.getSnapshot(f.key).running, true)
  f.setTasks([])
  await f.poller.poll()
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: false, unread: true })
})

test('losing provider telemetry does not clear independently tracked panel tasks', async () => {
  const f = fixture()
  f.activity.report(f.key, 'panel:tab', ['panel-task'])
  await f.poller.poll()
  f.setTasks(new Error('provider offline'))
  await f.poller.poll()
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: true, unread: false })
})

test('disposed pollers ignore late responses and overlapping polls do not duplicate reads', async () => {
  const f = fixture()
  let finish
  f.setTasks(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const reading = f.poller.poll()
  await f.poller.poll()
  assert.equal(f.reads(), 1)
  f.poller.dispose()
  finish(['shell'])
  await reading
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: false, unread: false })
  await f.poller.poll()
  assert.equal(f.reads(), 1)
})

test('an unresponsive provider loses its running claim and late replies cannot restore it', async () => {
  const f = fixture({ timeoutMs: 10 })
  await f.poller.poll()
  assert.equal(f.activity.getSnapshot(f.key).running, true)
  let finish
  f.setTasks(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await f.poller.poll()
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: false, unread: false })
  assert.match(f.errors[0].message, /Timed out/)
  finish(['shell'])
  f.setTasks([])
  f.advance(1000)
  await f.poller.poll()
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: false, unread: false })
})

test('persistent failures back off to one retry per minute and report once until recovery', async () => {
  const f = fixture()
  f.setTasks(new Error('account unavailable'))
  await f.poller.poll()
  for (const delay of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
    const before = f.reads()
    f.activity.requestProbe(f.key)
    await f.poller.poll()
    assert.equal(f.reads(), before, 'probes must respect backoff')
    f.advance(delay - 1)
    await f.poller.poll()
    assert.equal(f.reads(), before)
    f.advance(1)
    await f.poller.poll()
    assert.equal(f.reads(), before + 1)
  }
  assert.equal(f.errors.length, 1)
  f.setTasks(['shell'])
  f.advance(60000)
  await f.poller.poll()
  assert.equal(f.activity.getSnapshot(f.key).running, true)
  f.setTasks(new Error('new outage'))
  await f.poller.poll()
  assert.equal(f.errors.length, 2, 'recovery resets error reporting and backoff')
  f.advance(1000)
  f.setTasks([])
  await f.poller.poll()
  assert.deepEqual(f.activity.getSnapshot(f.key), { running: false, unread: false })
})

test('a failing chat does not delay healthy active chats', async () => {
  const reads = []
  const f = fixture({
    getChats: () => [
      { id: 'failed', providerId: 'codex', status: 'active' },
      { id: 'healthy', providerId: 'codex', status: 'active' }
    ],
    readTasks: async (_providerId, id) => {
      reads.push(id)
      if (id === 'failed') throw new Error('unavailable')
      return ['shell']
    }
  })
  await f.poller.poll()
  await f.poller.poll()
  assert.deepEqual(reads, ['failed', 'healthy', 'healthy'])
  assert.equal(f.activity.getSnapshot('codex:healthy').running, true)
})
