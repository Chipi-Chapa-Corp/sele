import assert from 'node:assert/strict'
import test from 'node:test'
import { LimitResetQueue, nextLimitReset } from './LimitResetQueue.ts'

const now = 1_800_000_000_000
const limit = (resetsAt = now + 1000, extra = {}) => ({
  id: 'five_hour',
  label: 'Codex',
  kind: 'primary',
  usedPercent: 100,
  windowMinutes: 300,
  resetsAt,
  ...extra
})
const options = {
  model: 'test-model',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  serviceTier: null
}
const fixture = () => {
  let time = now
  const entries = new Map()
  const normal = ['already queued']
  let failure = false
  const backend = {
    list: async () => structuredClone([...entries.values()]),
    put: async (entry) => {
      entries.set(entry.id, structuredClone(entry))
    },
    remove: async (id) => {
      entries.delete(id)
    }
  }
  const create = () =>
    new LimitResetQueue(
      backend,
      async (entry) => {
        if (failure) throw new Error('offline')
        assert.equal(entry.options.model, options.model)
        normal.push(entry.content)
      },
      () => time
    )
  return {
    create,
    entries,
    normal,
    backend,
    setTime: (value) => {
      time = value
    },
    fail: (value) => {
      failure = value
    }
  }
}

test('selects a relevant future reset and normalizes seconds to milliseconds', () => {
  assert.equal(nextLimitReset([limit((now + 1000) / 1000)], now).resetsAt, now + 1000)
  assert.equal(nextLimitReset([limit(now - 1000), limit(null), limit(NaN)], now), null)
  assert.equal(nextLimitReset([limit(now + 1000, { usageScope: 'other' })], now, 'model'), null)
  assert.equal(
    nextLimitReset(
      [limit(now + 1000, { usedPercent: 50 }), limit(now + 2000, { usedPercent: 75 })],
      now
    ).resetsAt,
    now + 1000
  )
  assert.equal(nextLimitReset([limit(now + 1000), limit(now + 2000)], now).resetsAt, now + 2000)
})

test('persists creation date and frozen deadline; a restart before reset keeps prompts waiting', async () => {
  const f = fixture()
  let queue = f.create()
  await queue.add('codex', 'chat', 'first', options, [limit()])
  await queue.add('codex', 'chat', 'second', options, [limit()])
  await queue.close()
  queue = f.create()
  await queue.tick()
  const messages = await queue.list('codex', 'chat')
  assert.deepEqual(
    messages.map((message) => [message.content, message.createdAt, message.resetsAt]),
    [
      ['first', now, now + 1000],
      ['second', now, now + 1000]
    ]
  )
  assert.deepEqual(f.normal, ['already queued'])
})

test('a restart after a missed reset appends once to the normal queue in order', async () => {
  const f = fixture()
  const original = f.create()
  await original.add('codex', 'chat', 'first', options, [limit()])
  await original.add('codex', 'chat', 'second', options, [limit()])
  await original.close()
  f.setTime(now + 5000)
  const restarted = f.create()
  await Promise.all([restarted.tick(), restarted.tick()])
  assert.deepEqual(f.normal, ['already queued', 'first', 'second'])
  assert.deepEqual(await restarted.list('codex', 'chat'), [])
  await restarted.close()
  const again = f.create()
  await again.tick()
  assert.deepEqual(f.normal, ['already queued', 'first', 'second'])
})

test('new usage windows never postpone the original deadline; early resets release messages', async () => {
  const f = fixture()
  const queue = f.create()
  await queue.add('codex', 'chat', 'first', options, [limit()])
  await queue.observe('codex', 'other-chat', [limit(now + 9999, { usedPercent: 0 })])
  await queue.observe('claude', 'chat', [limit(now + 9999, { usedPercent: 0 })])
  await queue.tick()
  assert.equal(f.normal.length, 1)
  await queue.observe('codex', 'chat', [limit(now + 9999, { usedPercent: 0 })])
  await queue.tick()
  assert.deepEqual(f.normal, ['already queued', 'first'])
})

test('failed delivery retains prompts across restart and does not overtake the first prompt', async () => {
  const f = fixture()
  const queue = f.create()
  await queue.add('codex', 'chat', 'first', options, [limit()])
  await queue.add('codex', 'chat', 'second', options, [limit()])
  f.setTime(now + 1000)
  f.fail(true)
  await queue.tick()
  assert.equal((await queue.list('codex', 'chat'))[0].error, 'offline')
  assert.equal(f.entries.size, 2)
  await queue.close()
  f.fail(false)
  await f.create().tick()
  assert.deepEqual(f.normal, ['already queued', 'first', 'second'])
})

test('cancellation is scoped to its provider and chat; removed prompts never release', async () => {
  const f = fixture()
  const queue = f.create()
  await queue.add('codex', 'chat', 'first', options, [limit()])
  const [message] = await queue.list('codex', 'chat')
  await queue.remove('claude', 'chat', message.id)
  await queue.remove('codex', 'other', message.id)
  assert.equal(f.entries.size, 1)
  await queue.remove('codex', 'chat', message.id)
  f.setTime(now + 2000)
  await queue.tick()
  assert.deepEqual(f.normal, ['already queued'])
})

test('unknown reset dates fail visibly without storing or sending a prompt', async () => {
  const f = fixture()
  await assert.rejects(
    f.create().add('codex', 'chat', 'first', options, [limit(null)]),
    /unavailable/
  )
  assert.equal(f.entries.size, 0)
  assert.equal(f.normal.length, 1)
})

test('cancelling a failed handoff removes its local pending copy before forgetting the reset prompt', async () => {
  const f = fixture()
  const queue = f.create()
  await queue.add('codex', 'chat', 'first', options, [limit()])
  const [entry] = await queue.list('codex', 'chat')
  await assert.rejects(
    queue.remove('codex', 'chat', entry.id, async () => {
      throw new Error('cannot cancel yet')
    }),
    /cannot cancel yet/
  )
  assert.equal(f.entries.size, 1)
  await queue.remove('codex', 'chat', entry.id, async (pending) => {
    assert.equal(pending.id, entry.id)
    assert.equal(f.entries.has(entry.id), true)
  })
  assert.equal(f.entries.size, 0)
})
