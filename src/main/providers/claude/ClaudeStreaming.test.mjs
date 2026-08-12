import assert from 'node:assert/strict'
import test from 'node:test'
import { applyClaudeStreamEvent, clearClaudeStreamMessages } from './ClaudeStreaming.ts'

// Test fixtures intentionally cover only the stable fields consumed by the accumulator.
let nextEventId = 0
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const streamEvent = (event) => ({
  type: 'stream_event',
  event,
  parent_tool_use_id: null,
  uuid: `stream-frame-${++nextEventId}`,
  session_id: 'session-1'
})

test('assembles streaming thinking and text in content-block order', () => {
  const partials = new Map()
  applyClaudeStreamEvent(
    partials,
    streamEvent({
      type: 'message_start',
      message: { id: 'api-message-1', role: 'assistant', model: 'claude-fable-5', content: [] }
    })
  )
  applyClaudeStreamEvent(
    partials,
    streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' }
    })
  )
  applyClaudeStreamEvent(
    partials,
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Inspecting', estimated_tokens: null }
    })
  )
  applyClaudeStreamEvent(
    partials,
    streamEvent({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: '', citations: null }
    })
  )
  applyClaudeStreamEvent(
    partials,
    streamEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'Hello' }
    })
  )
  applyClaudeStreamEvent(
    partials,
    streamEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: ' world' }
    })
  )

  const partial = partials.get('session-1:root')
  assert.equal(partial.uuid, 'api-message-1:partial')
  assert.deepEqual(partial.message.content, [
    { type: 'thinking', thinking: 'Inspecting', signature: '' },
    { type: 'text', text: 'Hello world', citations: null }
  ])
})

test('replaces a partial stream when its completed assistant message arrives', () => {
  const partials = new Map()
  applyClaudeStreamEvent(
    partials,
    streamEvent({
      type: 'message_start',
      message: { id: 'api-message-1', role: 'assistant', model: 'claude-fable-5', content: [] }
    })
  )

  clearClaudeStreamMessages(partials, {
    session_id: 'session-1',
    parent_tool_use_id: null
  })
  assert.equal(partials.size, 0)
})
