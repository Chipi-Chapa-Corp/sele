import assert from 'node:assert/strict'
import test from 'node:test'
import { includeConversationTime } from './conversationTiming.ts'
import { renderCopilotChatItems } from './copilot/CopilotItemRenderers.ts'
import { renderOpenCodeChatItems } from './opencode/OpenCodeItemRenderers.ts'
import { renderClaudeChatItems, ClaudeTranscriptProjection } from './claude/ClaudeItemRenderers.ts'
import { getChatItems, CodexTranscriptProjection } from './codex/CodexItemRenderers.ts'
import { markTranscriptRecordsChanged } from './transcriptProjection/recordChanges.ts'

const options = { active: true, stopped: false }
const iso = (ms) => new Date(ms).toISOString()
const step = (items) => items.find((item) => item.type === 'working')
const times = (item) => [item.startedAt, item.completedAt]

test('overlapping and out-of-order tool spans measure elapsed wall time', () => {
  let timing = includeConversationTime(undefined, 1000, 8000)
  timing = includeConversationTime(timing, 3000, 10000)
  timing = includeConversationTime(timing, 500, 2000)
  assert.deepEqual(timing, { startedAt: 500, completedAt: 10000 })
  assert.deepEqual(includeConversationTime(timing, NaN, Infinity), timing)
})

test('Copilot spans agent-loop turns and freezes at final answer start', () => {
  const events = [
    { type: 'user.message', id: 'u', timestamp: iso(1000), data: { content: 'Work' } },
    { type: 'assistant.turn_start', id: 's1', timestamp: iso(2000), data: { turnId: '1' } },
    { type: 'assistant.reasoning', id: 'r', timestamp: iso(3000), data: { content: 'Thinking' } },
    { type: 'assistant.turn_end', id: 'e1', timestamp: iso(8000), data: { turnId: '1' } },
    { type: 'assistant.turn_start', id: 's2', timestamp: iso(9000), data: { turnId: '2' } }
  ]
  assert.deepEqual(times(step(renderCopilotChatItems(events, options))), [1000, undefined])
  events.push({
    type: 'assistant.message',
    id: 'a',
    timestamp: iso(12000),
    data: { content: 'Done', phase: 'final_answer' }
  })
  assert.deepEqual(times(step(renderCopilotChatItems(events, options))), [1000, 12000])
  events.push({
    type: 'assistant.turn_end',
    id: 'e2',
    timestamp: iso(16000),
    data: { turnId: '2' }
  })
  assert.deepEqual(
    times(step(renderCopilotChatItems(events, { ...options, active: false }))),
    [1000, 12000]
  )
})

test('OpenCode uses the part start for the final boundary and does not sum parallel work', () => {
  const messages = [
    {
      info: { role: 'user', id: 'u', time: { created: 1000 } },
      parts: [{ type: 'text', text: 'Work' }]
    },
    {
      info: { role: 'assistant', id: 'a', time: { created: 2000, completed: 20000 } },
      parts: [
        { id: 'r1', type: 'reasoning', text: 'Thinking', time: { start: 2000, end: 9000 } },
        { id: 'r2', type: 'reasoning', text: 'Checking', time: { start: 4000, end: 12000 } },
        { id: 'answer', type: 'text', text: 'Done', time: { start: 15000, end: 20000 } }
      ]
    }
  ]
  assert.deepEqual(times(step(renderOpenCodeChatItems(messages, options))), [1000, 15000])
  assert.deepEqual(
    times(step(renderOpenCodeChatItems(messages, { ...options, active: false }))),
    [1000, 15000]
  )
})

test('Claude incremental and restored timing agree; streaming final start survives result completion', () => {
  const source = [
    { type: 'user', uuid: 'u', timestamp: iso(1000), message: { content: 'Work' } },
    {
      type: 'assistant',
      uuid: 'a',
      timestamp: iso(2000),
      message: { content: [{ type: 'thinking', thinking: 'Thinking' }] }
    }
  ]
  const projection = new ClaudeTranscriptProjection()
  assert.deepEqual(times(step(projection.read(source, [], options).items)), [1000, undefined])
  const final = {
    type: 'assistant',
    uuid: 'final',
    timestamp: iso(3000),
    message: { content: [{ type: 'text', text: 'Done', startedAtMs: 12000 }] }
  }
  const result = {
    type: 'system',
    uuid: 'timing',
    timestamp: iso(20000),
    message: { subtype: 'sele_turn_timing', duration_ms: 19000 }
  }
  for (const overlays of [[final], [final, result]]) {
    const full = step(renderClaudeChatItems([...source, ...overlays], options))
    const projected = step(projection.read(source, overlays, options).items)
    assert.deepEqual(times(full), [1000, 12000])
    assert.deepEqual(times(projected), times(full))
  }
  assert.deepEqual(
    times(step(projection.read(source, [], options).items)),
    [1000, undefined],
    'overlay timing rolls back'
  )
  const restored = structuredClone(final)
  delete restored.message.content[0].startedAtMs
  restored.timestamp = iso(12000)
  assert.deepEqual(
    times(step(renderClaudeChatItems([...source, restored], { ...options, active: false }))),
    [1000, 12000]
  )
})

test('Codex keeps section boundaries through steering and final text deltas', () => {
  const projection = new CodexTranscriptProjection()
  let turn = {
    id: 't',
    status: 'inProgress',
    startedAt: 1,
    items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'Work' }] },
      { id: 'r', type: 'agentMessage', phase: 'commentary', text: 'Thinking' },
      {
        id: 's',
        type: 'userMessage',
        startedAtMs: 10000,
        content: [{ type: 'text', text: 'Steer' }]
      },
      { id: 'r2', type: 'agentMessage', phase: 'commentary', text: 'More thinking' }
    ]
  }
  getChatItems([turn], null, {}, projection)
  const items = [
    ...turn.items,
    { id: 'f', type: 'agentMessage', phase: 'final_answer', startedAtMs: 18000, text: '' }
  ]
  markTranscriptRecordsChanged(turn.items, items, turn.items.length)
  turn = { ...turn, items }
  for (const status of ['inProgress', 'completed']) {
    const snapshot = { ...turn, status, ...(status === 'completed' ? { completedAt: 25 } : {}) }
    const projected = getChatItems([snapshot], null, {}, projection)
    assert.deepEqual(projected, getChatItems([snapshot]))
    if (status === 'inProgress')
      assert.deepEqual(projected.filter((item) => item.type === 'working').map(times), [
        [1000, 10000],
        [10000, 18000]
      ])
  }
})

test('Claude result duration supplies wall time when message timestamps are missing', () => {
  const records = [
    { type: 'user', uuid: 'u', message: { content: 'Work' } },
    {
      type: 'assistant',
      uuid: 'r',
      message: { content: [{ type: 'thinking', thinking: 'Thinking' }] }
    },
    {
      type: 'system',
      uuid: 'end',
      timestamp: iso(20000),
      message: { subtype: 'sele_turn_timing', duration_ms: 19000, duration_api_ms: 2000 }
    }
  ]
  const settings = { ...options, active: false }
  assert.deepEqual(times(step(renderClaudeChatItems(records, settings))), [1000, 20000])
  assert.deepEqual(
    times(step(new ClaudeTranscriptProjection().read(records, [], settings).items)),
    [1000, 20000]
  )
})
