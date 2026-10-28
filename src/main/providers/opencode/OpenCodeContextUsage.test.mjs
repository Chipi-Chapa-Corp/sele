import assert from 'node:assert/strict'
import test from 'node:test'
import { getOpenCodeContextUsage } from './OpenCodeContextUsage.ts'
import { queueOpenCodeMessageEvent } from './OpenCodeEvents.ts'

const message = (id, input = 10, output = 2) => ({
  info: {
    id,
    role: 'assistant',
    providerID: 'provider',
    modelID: 'model',
    time: { created: 1 },
    tokens: { input, output, reasoning: 3, cache: { read: 4, write: 0 } }
  },
  parts: [{ id: 'text', messageID: id, type: 'text', text: '' }]
})
const limits = new Map([['provider/model', 100_000]])
const read = (state) => getOpenCodeContextUsage(state, limits)

test('context totals update the changed suffix and preserve previously published totals', () => {
  const state = { messages: [message('a'), message('b')] }
  const before = read(state)
  assert.equal(before.total.totalTokens, 38)
  assert.equal(before.usedTokens, 19)
  assert.equal(before.maxTokens, 100_000)
  queueOpenCodeMessageEvent(state, 'message.updated', { info: message('b', 20, 5).info })
  const updated = read(state)
  assert.equal(updated.total.totalTokens, 51)
  assert.equal(updated.usedTokens, 32)
  assert.equal(before.total.totalTokens, 38)
  assert.equal(read(state).total, updated.total)
  queueOpenCodeMessageEvent(state, 'message.removed', { messageID: 'b' })
  assert.equal(read(state).total.totalTokens, 19)
  queueOpenCodeMessageEvent(state, 'message.updated', { info: message('c', 30, 6).info })
  assert.equal(read(state).total.totalTokens, 62)
})

test('streamed text does not rescan historical token records on each publication', () => {
  let reads = 0
  const state = {
    messages: Array.from({ length: 10_000 }, (_, index) => {
      const record = message(String(index))
      return {
        get info() {
          reads++
          return record.info
        },
        parts: record.parts
      }
    })
  }
  assert.equal(read(state).total.totalTokens, 190_000)
  queueOpenCodeMessageEvent(state, 'message.part.delta', {
    messageID: '9999',
    partID: 'text',
    field: 'text',
    delta: 'x'
  })
  reads = 0
  assert.equal(read(state).total.totalTokens, 190_000)
  assert.ok(reads < 10, 'a tail update must only visit the old and new contributions')
  for (let index = 0; index < 50; index++) {
    queueOpenCodeMessageEvent(state, 'message.part.delta', {
      messageID: '9999',
      partID: 'text',
      field: 'text',
      delta: 'x'
    })
    assert.equal(read(state).total.totalTokens, 190_000)
  }
  assert.ok(reads < 10, 'later text publications retain the untouched history prefix')
})

test('authoritative replacements, user records, compaction and model limits keep their semantics', () => {
  const state = { messages: [message('old')] }
  const previous = read(state)
  // A native replacement has no incremental provenance and must rebuild the total.
  state.messages = [
    message('summary', 50, 8),
    { info: { id: 'user', role: 'user', time: { created: 2 } }, parts: [] }
  ]
  assert.equal(read(state).total.totalTokens, 65)
  assert.equal(previous.total.totalTokens, 19)
  limits.set('provider/model', 200_000)
  assert.equal(read(state).maxTokens, 200_000)
  limits.set('provider/model', 100_000)
  state.messages = [{ info: { id: 'user', role: 'user', time: { created: 2 } }, parts: [] }]
  assert.equal(read(state), null)
})
