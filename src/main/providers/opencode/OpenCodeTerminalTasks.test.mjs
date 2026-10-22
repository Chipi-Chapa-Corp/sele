import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenCodeTerminalTasks } from './OpenCodeTerminalTasks.ts'

const reply = (created, parts = [], extra = {}) => ({
  info: { id: `reply-${created}`, role: 'assistant', time: { created }, ...extra },
  parts
})
const shell = (start, status = 'running', extra = {}) => ({
  type: 'tool',
  tool: 'bash',
  callID: `shell-${start}`,
  state: { status, time: { start } },
  ...extra
})
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const fixture = () => {
  let now = 100
  const tracker = createOpenCodeTerminalTasks(() => now)
  let status = { type: 'busy' }
  let messages = [reply(110, [shell(120)])]
  let historyReads = 0
  const read = () =>
    tracker.read(
      'chat',
      async () => status,
      async () => {
        historyReads++
        return messages
      }
    )
  return {
    tracker,
    read,
    setNow: (value) => {
      now = value
    },
    setStatus: (value) => {
      status = value
    },
    setMessages: (value) => {
      messages = value
    },
    historyReads: () => historyReads
  }
}

test('only shells in the current unfinished assistant step of a busy execution count', async () => {
  const f = fixture()
  f.setMessages([
    reply(110, [
      shell(120),
      shell(121, 'pending'),
      shell(122, 'completed'),
      shell(123, 'error'),
      shell(124, 'running', { tool: 'read' })
    ])
  ])
  assert.deepEqual(await f.read(), ['shell-120', 'shell-121'])
  f.setMessages([reply(110, [shell(120)]), reply(130)])
  assert.deepEqual(await f.read(), [], 'a later step supersedes an abandoned shell record')
  for (const extra of [
    { time: { created: 110, completed: 130 } },
    { error: { name: 'MessageAbortedError' } },
    { summary: true }
  ]) {
    f.setMessages([reply(110, [shell(120)], extra)])
    assert.deepEqual(await f.read(), [])
  }
})

test('idle, missing and retry statuses never turn transcript records into background tasks', async () => {
  for (const status of [{ type: 'idle' }, undefined, { type: 'retry' }]) {
    const f = fixture()
    f.setStatus(status)
    assert.deepEqual(await f.read(), [])
    assert.equal(f.historyReads(), 0, 'idle discovery must not fetch chat history')
  }
})

test('a restarted server cannot inherit orphaned running or pending tool records', async () => {
  const f = fixture()
  f.setMessages([reply(10, [shell(20), shell(21, 'pending')])])
  assert.deepEqual(await f.read(), [], 'even a new busy session cannot revive old work')
  f.setMessages([reply(110, [shell(120)])])
  assert.deepEqual(await f.read(), ['shell-120'])
})

test('idle, error and abort boundaries invalidate old work across later busy turns', async () => {
  const f = fixture()
  assert.deepEqual(await f.read(), ['shell-120'])
  f.setNow(150)
  f.tracker.invalidate('chat')
  assert.deepEqual(await f.read(), [])
  f.setMessages([reply(160, [shell(170)])])
  assert.deepEqual(await f.read(), ['shell-170'])
  f.setNow(180)
  f.setStatus({ type: 'idle' })
  assert.deepEqual(await f.read(), [])
  f.setStatus({ type: 'busy' })
  assert.deepEqual(await f.read(), [], 'polling also reconciles a missed idle event')
})

test('an idle event during a history request prevents a late response resurrecting work', async () => {
  const f = fixture()
  const history = deferred()
  const reading = f.tracker.read(
    'chat',
    async () => ({ type: 'busy' }),
    () => history.promise
  )
  await Promise.resolve()
  f.setNow(150)
  f.tracker.invalidate('chat')
  history.resolve([reply(110, [shell(120)])])
  assert.deepEqual(await reading, [])
})

test('an old idle response cannot invalidate a newer busy execution', async () => {
  const f = fixture()
  const status = deferred()
  const reading = f.tracker.read(
    'chat',
    () => status.promise,
    async () => []
  )
  f.tracker.advance('chat')
  status.resolve({ type: 'idle' })
  assert.deepEqual(await reading, [])
  assert.deepEqual(await f.read(), ['shell-120'])
})

test('server loss and failed status reads are unknown rather than successful completion', async () => {
  const f = fixture()
  const history = deferred()
  const reading = f.tracker.read(
    'chat',
    async () => ({ type: 'busy' }),
    () => history.promise
  )
  await Promise.resolve()
  f.tracker.dispose()
  history.resolve([reply(110, [shell(120)])])
  await assert.rejects(reading, /unavailable/)
  await assert.rejects(f.read(), /unavailable/)
  const live = fixture()
  await assert.rejects(
    live.tracker.read(
      'chat',
      async () => {
        throw new Error('offline')
      },
      async () => []
    ),
    /offline/
  )
})
