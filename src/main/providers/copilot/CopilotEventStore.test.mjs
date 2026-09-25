import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileProviderRecords } from '../ProviderConversationEngine.ts'
import { getUnchangedTranscriptPrefix } from '../transcriptProjection/recordChanges.ts'
import { CopilotEventStore } from './CopilotEventStore.ts'

const compare = (a, b) => a.timestamp - b.timestamp
const reference = (current, next) =>
  reconcileProviderRecords(current, [next], {
    authoritative: false,
    getId: (record) => record.id,
    compare
  })

test('incremental Copilot event order matches reconciliation for inserts and replacements', () => {
  const first = { id: 'a', timestamp: 20 }
  const store = new CopilotEventStore([], (record) => record.timestamp)
  let expected = []
  const changes = [
    first,
    { id: 'b', timestamp: 10 },
    { id: 'c', timestamp: 20 },
    { id: 'd', timestamp: 30 },
    { id: 'a', timestamp: 10 },
    { id: 'c', timestamp: 10 },
    { id: 'b', timestamp: 40 },
    { id: 'e', timestamp: 10 },
    { id: 'd', timestamp: 10 },
    { id: 'a', timestamp: 50 }
  ]
  for (const event of changes) {
    expected = reference(expected, event)
    assert.deepEqual(store.add(event), expected)
    assert.equal(new Set(store.events.map((record) => record.id)).size, store.events.length)
    store.seal()
  }
})

test('published snapshots stay immutable and retain the earliest changed index', () => {
  const initial = Array.from({ length: 100 }, (_, index) => ({
    id: String(index),
    timestamp: index
  }))
  const store = new CopilotEventStore(initial, (record) => record.timestamp)
  const published = store.seal()
  store.add({ id: '100', timestamp: 100 })
  store.add({ id: '50', timestamp: 50, value: 'updated' })
  store.add({ id: '101', timestamp: 101 })
  const next = store.seal()
  assert.notEqual(next, published)
  assert.equal(published.length, 100)
  assert.equal(published[50].value, undefined)
  assert.equal(getUnchangedTranscriptPrefix(published, next), 50)
  assert.deepEqual(next, [
    ...initial.slice(0, 50),
    { id: '50', timestamp: 50, value: 'updated' },
    ...initial.slice(51),
    { id: '100', timestamp: 100 },
    { id: '101', timestamp: 101 }
  ])
  assert.equal(store.seal(), next)
})

test('streaming appends have constant indexing work at large history sizes', () => {
  for (const size of [100, 10_000, 100_000]) {
    let identityReads = 0
    let timestampReads = 0
    const record = (number) => ({
      get id() {
        identityReads += 1
        return String(number)
      },
      get timestamp() {
        timestampReads += 1
        return number
      }
    })
    const store = new CopilotEventStore(
      Array.from({ length: size }, (_, index) => record(index)),
      (event) => event.timestamp
    )
    store.seal()
    identityReads = 0
    timestampReads = 0
    for (let index = 0; index < 100; index += 1) {
      store.add(record(size + index))
    }
    assert.equal(store.events.length, size + 100)
    assert.ok(identityReads <= 300, `${size}: ${identityReads} ID reads for 100 appends`)
    assert.ok(timestampReads <= 100, `${size}: ${timestampReads} timestamp reads`)
  }
})

test('authoritative reload can start a new indexed branch before live deltas arrive', () => {
  const original = new CopilotEventStore([{ id: 'live', timestamp: 3 }], (event) => event.timestamp)
  const first = original.seal()
  const authoritative = reconcileProviderRecords(first, [{ id: 'persisted', timestamp: 1 }], {
    authoritative: true,
    getId: (event) => event.id,
    compare,
    retainCurrent: (event) => event.id === 'live'
  })
  const reloaded = new CopilotEventStore(authoritative, (event) => event.timestamp)
  const next = reloaded.add({ id: 'delta', timestamp: 2 })
  assert.deepEqual(
    next.map((event) => event.id),
    ['persisted', 'delta', 'live']
  )
  assert.deepEqual(
    authoritative.map((event) => event.id),
    ['persisted', 'live']
  )
  assert.equal(getUnchangedTranscriptPrefix(authoritative, reloaded.seal()), 1)
})

test('streaming deltas, terminal events, and missing timestamps keep stable event order', () => {
  const store = new CopilotEventStore([], (event) => event.timestamp)
  const events = [
    { id: 'user', type: 'user.message', timestamp: 1 },
    { id: 'delta-1', type: 'assistant.message_delta', timestamp: 2 },
    { id: 'delta-2', type: 'assistant.message_delta', timestamp: 2 },
    { id: 'answer', type: 'assistant.message', timestamp: 3 },
    { id: 'idle', type: 'session.idle', timestamp: 4 }
  ]
  for (const event of events) store.add(event)
  assert.deepEqual(
    store.seal().map((event) => event.id),
    events.map((event) => event.id)
  )
  const now = Date.now
  Date.now = () => 5
  try {
    store.add({ id: 'missing', type: 'assistant.reasoning_delta', timestamp: Number.NaN })
  } finally {
    Date.now = now
  }
  assert.equal(store.seal().at(-1).id, 'missing')
})
