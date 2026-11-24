import assert from 'node:assert/strict'
import test from 'node:test'
import { numberCodexBenchmarkReplay, replaceCodexBenchmarkAnswer } from './CodexBenchmarkHistory.ts'

const event = (type, payload = {}) => ({
  type: 'event_msg',
  payload: { type, turn_id: 'round-2', ...payload }
})
const response = (id, role, text) => ({
  type: 'response_item',
  payload: { type: 'message', id, role, content: [{ type: 'output_text', text }] }
})

test('replace a Codex answer in both the model context and paginated transcript', () => {
  const prior = [
    { type: 'session_meta', payload: { id: 'chat' } },
    response('earlier', 'assistant', 'Earlier answer'),
    event('task_started'),
    response('prompt', 'user', 'Keep the prompt'),
    event('item_completed', { item: { type: 'UserMessage', id: 'user' } })
  ]
  const records = [
    ...prior,
    response('partial', 'assistant', 'Discarded partial'),
    event('item_completed', { item: { type: 'ToolCall', id: 'tool' } }),
    response('answer', 'assistant', 'Discarded answer'),
    event('item_completed', { item: { type: 'AgentMessage', id: 'answer', content: [] } }),
    { type: 'token_usage_record', payload: { output: 5 } },
    event('task_complete', { last_agent_message: 'Discarded answer' })
  ]
  const replaced = replaceCodexBenchmarkAnswer(records, 'chat', 'round-2', 'user', 'Preferred')
  assert.deepEqual(replaced.slice(0, prior.length), prior)
  assert.doesNotMatch(JSON.stringify(replaced), /Discarded|ToolCall/)
  assert.equal(
    replaced.find(({ payload }) => payload.id === 'answer').payload.content[0].text,
    'Preferred'
  )
  assert.equal(
    replaced.find(({ payload }) => payload.item?.id === 'answer').payload.item.content[0].text,
    'Preferred'
  )
  assert.equal(replaced.at(-1).payload.last_agent_message, 'Preferred')
  assert.ok(replaced.some(({ type }) => type === 'token_usage_record'))
  assert.throws(
    () => replaceCodexBenchmarkAnswer(records, 'chat', 'round-2', 'old', 'Preferred'),
    /changed/
  )
  assert.throws(
    () => replaceCodexBenchmarkAnswer(records, 'chat', 'round-1', 'user', 'Preferred'),
    /latest completed/
  )
})

test('a replayed Codex turn starts after the durable records in the new segment', () => {
  const base = [
    { type: 'session_meta', ordinal: 12 },
    { ...event('thread_settings_applied'), ordinal: 13 }
  ]
  const original = [
    { ...event('task_started'), ordinal: 12 },
    { ...response('answer', 'assistant', 'Preferred'), ordinal: 19 },
    { ...event('task_complete'), ordinal: 21 }
  ]
  const replayed = numberCodexBenchmarkReplay(base, original)
  assert.deepEqual(
    replayed.map(({ ordinal }) => ordinal),
    [14, 15, 16]
  )
  assert.deepEqual(
    replayed.map(({ payload }) => payload),
    original.map(({ payload }) => payload)
  )
  assert.equal(original[0].ordinal, 12)
})
