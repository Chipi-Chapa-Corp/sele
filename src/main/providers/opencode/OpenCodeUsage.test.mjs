import assert from 'node:assert/strict'
import test from 'node:test'
import { usesLocalOpenCodeAuth, mapOpenCodeGoUsageToRateLimits } from './OpenCodeUsage.ts'
import { isOpenCodeRateLimitError, renderOpenCodeChatItems } from './OpenCodeItemRenderers.ts'

test('maps go usage windows to rate limits', () => {
  const rateLimits = mapOpenCodeGoUsageToRateLimits({
    rolling: { status: 'ok', percent: 65, resetsAt: '2026-09-07T10:00:00.000Z' },
    weekly: { status: 'ok', percent: 30, resetsAt: '2026-09-14T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 12, resetsAt: '2026-10-01T00:00:00.000Z' }
  })
  assert.equal(rateLimits.length, 3)
  assert.deepEqual(
    rateLimits.map((limit) => [limit.id, limit.displayLabel, limit.windowMinutes, limit.kind]),
    [
      ['five_hour', '5-hour limit', 300, 'primary'],
      ['weekly', 'Weekly limit', 10_080, 'secondary'],
      ['monthly', 'Monthly limit', 43_200, 'secondary']
    ]
  )
  assert.equal(rateLimits[0]?.usedPercent, 65)
  assert.equal(rateLimits[0]?.resetsAt, Date.parse('2026-09-07T10:00:00.000Z'))
})

test('skips windows without a numeric percent', () => {
  const rateLimits = mapOpenCodeGoUsageToRateLimits({
    rolling: { status: 'ok', percent: 101, resetsAt: null },
    weekly: null,
    monthly: { status: 'ok', percent: 'half' }
  })
  assert.equal(rateLimits.length, 1)
  assert.equal(rateLimits[0]?.usedPercent, 100)
  assert.equal(rateLimits[0]?.resetsAt, null)
})

test('detects opencode rate-limit errors', () => {
  assert.equal(isOpenCodeRateLimitError({ data: { message: 'GoUsageLimitError: limit' } }), true)
  assert.equal(isOpenCodeRateLimitError({ message: 'Free usage exceeded, subscribe to Go' }), true)
  assert.equal(isOpenCodeRateLimitError({ message: 'Error 429 from provider' }), true)
  assert.equal(isOpenCodeRateLimitError({ message: 'context too long' }), false)
  assert.equal(isOpenCodeRateLimitError(null), false)
})

test('host bridges and selected containers read credentials in their target', () => {
  assert.equal(usesLocalOpenCodeAuth(null, false, false), true)
  assert.equal(usesLocalOpenCodeAuth({ kind: 'host' }, false, true), false)
  assert.equal(usesLocalOpenCodeAuth(null, true, false), false)
  assert.equal(
    usesLocalOpenCodeAuth({ kind: 'container', tool: 'toolbox', name: 'dev' }, false, false),
    false
  )
})

test('structured 429 errors render as rate limits without matching unrelated request IDs', () => {
  const error = {
    name: 'APIError',
    data: { message: 'Too Many Requests', statusCode: 429, isRetryable: true }
  }
  assert.equal(isOpenCodeRateLimitError(error), true)
  assert.equal(
    isOpenCodeRateLimitError({ data: { message: 'Request 42901 failed', statusCode: 500 } }),
    false
  )
  const items = renderOpenCodeChatItems(
    [{ info: { id: 'a', role: 'assistant', time: { created: 1 }, error }, parts: [] }],
    { active: false, stopped: false }
  )
  assert.equal(items[0].failureReason, 'rateLimit')
  assert.equal(items[0].failureMessage, 'Too Many Requests')
})

test('keeps an OpenCode session error when no assistant error record arrives', () => {
  const items = renderOpenCodeChatItems(
    [
      {
        info: { id: 'u', role: 'user', time: { created: 1 } },
        parts: [{ type: 'text', text: 'Help' }]
      }
    ],
    { active: false, stopped: false, failed: true, failureMessage: 'Provider connection lost' }
  )
  assert.equal(
    items.find((item) => item.type === 'working')?.failureMessage,
    'Provider connection lost'
  )
  assert.equal(
    items.find((item) => item.type === 'working')?.items[0]?.content,
    'Provider connection lost'
  )
})

test('completed assistant messages do not end a still-active tool loop', () => {
  const messages = [
    {
      info: {
        id: 'a',
        role: 'assistant',
        time: { created: 1, completed: 2 },
        finish: 'tool-calls'
      },
      parts: [{ id: 'r', type: 'reasoning', text: 'Working on it' }]
    }
  ]
  assert.equal(
    renderOpenCodeChatItems(messages, { active: true, stopped: false })[0].status,
    'working'
  )
  assert.equal(
    renderOpenCodeChatItems(messages, { active: false, stopped: false })[0].status,
    'stopped'
  )
  assert.equal(
    renderOpenCodeChatItems(messages, { active: false, stopped: true })[0].status,
    'stopped'
  )
})

test('maps native v2 usage reset timestamps', () => {
  const resetsAt = 1793220000000
  assert.equal(
    mapOpenCodeGoUsageToRateLimits({ rolling: { percent: 25, resetsAt } })[0].resetsAt,
    resetsAt
  )
})
