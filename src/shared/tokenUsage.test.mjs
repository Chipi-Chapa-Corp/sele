import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTurnTokenUsage,
  formatTurnTokenUsage,
  normalizeTokenUsage,
  totalTokenUsage
} from './tokenUsage.ts'
import { getTokenUsageIncrement } from '../main/providers/TokenUsageReporter.ts'
import { ClaudeLiveTokenUsage } from '../main/providers/claude/ClaudeLiveTokenUsage.ts'

test('normalizes inclusive and exclusive cache counts into disjoint spend categories', () => {
  const inclusive = normalizeTokenUsage(120, 80, 30, true)
  const exclusive = normalizeTokenUsage(40, 80, 30)
  assert.deepEqual(inclusive, exclusive)
  assert.equal(totalTokenUsage(inclusive), 150)
  assert.equal(formatTurnTokenUsage(inclusive), '—$')
  assert.deepEqual(normalizeTokenUsage(NaN, -1, Infinity), {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0
  })
})

test('cumulative usage handles duplicates, unobserved history, stale events and resets', () => {
  const observation = {
    usage: normalizeTokenUsage(200, 80, 60),
    timestamp: 2000,
    initialUsage: normalizeTokenUsage(20, 10, 5)
  }
  assert.deepEqual(getTokenUsageIncrement(observation), observation.initialUsage)
  const previous = { usage: normalizeTokenUsage(160, 70, 30), timestamp: 1000 }
  assert.deepEqual(getTokenUsageIncrement(observation, previous), normalizeTokenUsage(40, 10, 30))
  assert.deepEqual(
    getTokenUsageIncrement(observation, { usage: observation.usage, timestamp: 2000 }),
    normalizeTokenUsage(0, 0, 0)
  )
  assert.equal(getTokenUsageIncrement({ ...observation, timestamp: 500 }, previous), null)
  assert.deepEqual(
    getTokenUsageIncrement({ ...observation, usage: normalizeTokenUsage(10, 0, 2) }, previous),
    observation.initialUsage
  )
})

test('turn usage survives bounded windows, goal turns and unloaded working payloads', () => {
  const first = normalizeTokenUsage(40, 80, 30)
  const second = normalizeTokenUsage(100, 0, 20)
  const items = [
    { type: 'message', id: 'user', role: 'user', content: '' },
    { type: 'working', id: 'user:working', status: 'worked', items: [], itemsLoaded: false },
    {
      type: 'working',
      id: 'goal:working',
      usageTurnId: 'goal',
      startsTurn: true,
      status: 'working',
      items: []
    }
  ]
  const result = applyTurnTokenUsage(
    items,
    new Map([
      ['user', first],
      ['goal', second]
    ])
  )
  assert.equal(result[0], items[0])
  assert.equal(result[1].tokenUsage, first)
  assert.equal(result[2].tokenUsage, second)
  assert.equal(items[1].tokenUsage, undefined, 'provider snapshots remain immutable')
  assert.equal(applyTurnTokenUsage([items[1]], new Map([['user', first]]))[0].tokenUsage, first)
})

test('Claude live counts use actual output deltas and preserve independent agent streams', () => {
  const live = new ClaudeLiveTokenUsage()
  const control = {}
  const message = {
    id: 'request',
    usage: {
      input_tokens: 100,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 80,
      output_tokens: 0
    }
  }
  const initial = live.consume(
    control,
    { type: 'stream_event', event: { type: 'message_start', message }, user_message_uuid: 'user' },
    null,
    123
  )
  assert.deepEqual(initial.usage, normalizeTokenUsage(120, 80, 0))
  live.consume(
    control,
    {
      type: 'stream_event',
      parent_tool_use_id: 'child',
      event: {
        type: 'message_start',
        message: { id: 'child-request', usage: { input_tokens: 10, output_tokens: 0 } }
      }
    },
    'user',
    125
  )
  const delta = live.consume(
    control,
    { type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 50 } } },
    'later',
    130
  )
  assert.equal(delta.id, 'request')
  assert.equal(delta.turnId, 'user')
  assert.equal(delta.timestamp, 123)
  assert.deepEqual(delta.usage, normalizeTokenUsage(120, 80, 50))
  const placeholder = live.consume(
    control,
    { type: 'assistant', message: { ...message, usage: { ...message.usage, output_tokens: 1 } } },
    'later',
    140
  )
  assert.equal(
    placeholder.usage.outputTokens,
    50,
    'assistant-message placeholders must not replace actual output'
  )
  assert.equal(placeholder.completed, true)
})
