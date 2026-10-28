import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOpenCodeMessageEvent,
  forEachOpenCodeEvent,
  queueOpenCodeMessageEvent,
  reconcileOpenCodeMessageSnapshot
} from './OpenCodeEvents.ts'
import { getUnchangedTranscriptPrefix } from '../transcriptProjection/recordChanges.ts'

const message = (id, content = '') => ({
  info: { id, role: 'assistant', time: { created: 1 } },
  parts: [{ id: 'text', messageID: id, type: 'text', text: content }]
})
const delta = (id, text = '.') => ({ messageID: id, partID: 'text', field: 'text', delta: text })

test('token bursts visit history once and publish immutable snapshots only at read boundaries', () => {
  let visits = 0
  const initial = new Proxy(
    Array.from({ length: 10_000 }, (_, index) => message(String(index))),
    {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) visits++
        return Reflect.get(target, key, receiver)
      }
    }
  )
  const state = { messages: initial }
  assert.equal(queueOpenCodeMessageEvent(state, 'message.part.delta', delta('9999')), true)
  const firstEventVisits = visits
  assert.ok(
    firstEventVisits <= initial.length * 3 + 1,
    'one index/order check and one owned array copy'
  )
  for (let index = 0; index < 500; index++)
    assert.equal(queueOpenCodeMessageEvent(state, 'message.part.delta', delta('9999')), true)
  assert.equal(visits, firstEventVisits, 'subsequent tokens must not scan or copy history')
  const published = state.messages
  assert.equal(published.at(-1).parts[0].text.length, 501)
  assert.equal(initial.at(-1).parts[0].text, '')
  assert.equal(getUnchangedTranscriptPrefix(initial, published), 9999)
  assert.equal(state.messages, published, 'unchanged reads do not rebuild the snapshot')
  queueOpenCodeMessageEvent(state, 'message.part.delta', delta('9999', '!'))
  assert.equal(published.at(-1).parts[0].text.length, 501)
  assert.equal(state.messages.at(-1).parts[0].text.length, 502)
})

test('batched message edits, deletions and out-of-order additions match individual snapshots', () => {
  const state = { messages: [message('message-1'), message('message-3')] }
  let individual = state.messages
  let random = 123456
  const next = () => (random = (random * 1664525 + 1013904223) >>> 0) % 50
  for (let index = 0; index < 1000; index++) {
    const id = `message-${next()}`
    const [type, properties] =
      index % 7 === 0
        ? ['message.removed', { messageID: id }]
        : index % 3 === 0
          ? ['message.updated', { info: message(id).info }]
          : index % 3 === 1
            ? ['message.part.updated', { part: message(id, String(index)).parts[0] }]
            : ['message.part.delta', delta(id)]
    const updated = applyOpenCodeMessageEvent(individual, type, properties)
    assert.equal(queueOpenCodeMessageEvent(state, type, properties), updated !== null)
    if (updated) individual = updated
    if (index % 13 === 0) assert.deepEqual(state.messages, individual)
  }
  assert.deepEqual(state.messages, individual)
})

test('HTTP reconciliation sees pending live edits and replacing history resets the index', () => {
  const state = { messages: [message('old', 'Before')] }
  const before = state.messages
  queueOpenCodeMessageEvent(state, 'message.part.delta', delta('old', ' live'))
  const merged = reconcileOpenCodeMessageSnapshot(before, state.messages, structuredClone(before))
  state.messages = merged
  assert.equal(state.messages[0].parts[0].text, 'Before live')
  state.messages = [message('replacement', 'Fresh')]
  assert.equal(queueOpenCodeMessageEvent(state, 'message.part.delta', delta('old')), false)
  assert.equal(queueOpenCodeMessageEvent(state, 'message.part.delta', delta('replacement')), true)
  assert.equal(state.messages[0].parts[0].text, 'Fresh.')
  assert.equal(before[0].parts[0].text, 'Before')
})

test('adding a message also normalizes an unordered authoritative replacement', () => {
  const initial = [message('c'), message('a')]
  const state = { messages: initial }
  queueOpenCodeMessageEvent(state, 'message.updated', { info: message('z').info })
  assert.deepEqual(
    state.messages.map((record) => record.info.id),
    ['a', 'c', 'z']
  )
  assert.deepEqual(
    initial.map((record) => record.info.id),
    ['c', 'a']
  )
})

test('sessions own independent batches and unknown deltas retain the history recovery signal', () => {
  const a = { messages: [message('same')] }
  const b = { messages: a.messages }
  queueOpenCodeMessageEvent(a, 'message.part.delta', delta('same', 'A'))
  queueOpenCodeMessageEvent(b, 'message.part.delta', delta('same', 'B'))
  assert.equal(a.messages[0].parts[0].text, 'A')
  assert.equal(b.messages[0].parts[0].text, 'B')
  assert.equal(
    queueOpenCodeMessageEvent(a, 'message.part.delta', { ...delta('same'), partID: 'unknown' }),
    false
  )
  assert.equal(a.messages[0].parts[0].text, 'A')
})

test('buffered SSE bursts yield to IPC/timer work and stop consuming on abort', async () => {
  const controller = new AbortController()
  let yielded = false
  setImmediate(() => {
    yielded = true
  })
  const seen = []
  await forEachOpenCodeEvent(
    (async function* () {
      yield 1
      yield 2
      yield 3
    })(),
    controller.signal,
    (event) => {
      seen.push(event)
      if (event === 1) {
        const end = performance.now() + 9
        while (performance.now() < end) {
          /* one busy handler exhausts the event budget */
        }
      } else {
        assert.equal(yielded, true, 'another event must not run before the main loop gets a turn')
        controller.abort()
      }
    }
  )
  assert.deepEqual(seen, [1, 2])
})
