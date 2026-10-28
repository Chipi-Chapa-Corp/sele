import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatSeenWriter } from './chatSeenWriter.ts'

const deferred = () => {
  let resolve, reject
  const request = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { request, resolve, reject }
}

test('selection, refresh and departure share a write for the same observed update', async () => {
  const pending = deferred()
  const calls = []
  const mark = createChatSeenWriter((...args) => {
    calls.push(args)
    return pending.request
  })
  const first = mark('codex', 'chat', 100)
  assert.equal(mark('codex', 'chat', 100), first)
  assert.equal(mark('codex', 'chat', 90), first)
  pending.resolve({ id: 'chat', seenUpdatedAt: 100 })
  await first
  assert.equal(await mark('codex', 'chat', 100), null)
  assert.equal(await mark('codex', 'chat', 90), null)
  assert.equal(calls.length, 1)
})

test('new replies persist and an older acknowledgement cannot regress the watermark', async () => {
  const requests = []
  const mark = createChatSeenWriter(() => {
    const next = deferred()
    requests.push(next)
    return next.request
  })
  const old = mark('codex', 'chat', 100)
  const fresh = mark('codex', 'chat', 200)
  requests[1].resolve({ id: 'chat', seenUpdatedAt: 250 })
  await fresh
  requests[0].resolve({ id: 'chat', seenUpdatedAt: 100 })
  await old
  assert.equal(await mark('codex', 'chat', 250), null)
  assert.equal(requests.length, 2)
})

test('a failed write remains retryable without another content update', async () => {
  let attempts = 0
  const mark = createChatSeenWriter(async (_provider, id, seenUpdatedAt) => {
    if (++attempts === 1) throw new Error('Disk unavailable')
    return { id, seenUpdatedAt }
  })
  await assert.rejects(mark('codex', 'chat', 100), /Disk unavailable/)
  assert.equal((await mark('codex', 'chat', 100)).seenUpdatedAt, 100)
  assert.equal(attempts, 2)
})

test('acknowledgements are provider scoped and bounded', async () => {
  const calls = []
  const mark = createChatSeenWriter(async (provider, id, seenUpdatedAt) => {
    calls.push([provider, id])
    return { id, seenUpdatedAt }
  }, 2)
  await mark('codex', 'a', 100)
  await mark('claude', 'a', 100)
  await mark('codex', 'b', 100)
  assert.equal(await mark('claude', 'a', 100), null)
  assert.ok(await mark('codex', 'a', 100), 'an evicted marker may safely be persisted again')
  assert.equal(calls.length, 4)
})
