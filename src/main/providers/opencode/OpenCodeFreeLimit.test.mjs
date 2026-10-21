import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getOpenCodeFreeLimitSignal,
  OpenCodeFreeLimitTracker,
  parseOpenCodeRetryAfter
} from './OpenCodeFreeLimit.ts'

const now = Date.parse('2026-10-21T12:00:00.000Z')
const freeLimitBody = JSON.stringify({
  type: 'error',
  error: { type: 'FreeUsageLimitError', message: 'Rate limit exceeded. Please try again later.' },
  metadata: {}
})

test('reads the reset time from OpenCode retry status for the free tier', () => {
  assert.deepEqual(
    getOpenCodeFreeLimitSignal(
      'session.status',
      {
        status: {
          type: 'retry',
          attempt: 1,
          message: 'Free usage exceeded, subscribe to Go',
          action: { reason: 'free_tier_limit', provider: 'opencode' },
          next: now + 3_600_000
        }
      },
      now
    ),
    { resetsAt: now + 3_600_000 }
  )
  assert.equal(
    getOpenCodeFreeLimitSignal(
      'session.status',
      { status: { type: 'retry', attempt: 1, message: 'Overloaded', next: now + 1_000 } },
      now
    ),
    null
  )
  assert.equal(
    getOpenCodeFreeLimitSignal('session.status', { status: { type: 'busy' } }, now),
    null
  )
})

test('reads free-limit API errors with retry-after headers', () => {
  const error = (headers) => ({
    name: 'APIError',
    data: {
      message: 'Too Many Requests',
      statusCode: 429,
      responseBody: freeLimitBody,
      responseHeaders: headers
    }
  })
  assert.deepEqual(
    getOpenCodeFreeLimitSignal('session.error', { error: error({ 'Retry-After': '120' }) }, now),
    { resetsAt: now + 120_000 }
  )
  assert.deepEqual(
    getOpenCodeFreeLimitSignal(
      'message.updated',
      { info: { role: 'assistant', error: error({}) } },
      now
    ),
    { resetsAt: null }
  )
  assert.equal(
    getOpenCodeFreeLimitSignal(
      'session.error',
      { error: { name: 'APIError', data: { message: 'Too Many Requests', statusCode: 429 } } },
      now
    ),
    null
  )
  assert.deepEqual(
    getOpenCodeFreeLimitSignal(
      'session.error',
      { error: { type: 'provider.free-limit', retryAfterMs: 5_000 } },
      now
    ),
    { resetsAt: now + 5_000 }
  )
})

test('parses retry-after in milliseconds, seconds and HTTP dates', () => {
  assert.equal(parseOpenCodeRetryAfter({ 'retry-after-ms': '1500' }, now), now + 1_500)
  assert.equal(parseOpenCodeRetryAfter({ 'retry-after': '60' }, now), now + 60_000)
  assert.equal(
    parseOpenCodeRetryAfter({ 'retry-after': 'Thu, 22 Oct 2026 00:00:00 GMT' }, now),
    Date.parse('2026-10-22T00:00:00.000Z')
  )
  assert.equal(
    parseOpenCodeRetryAfter({ 'retry-after': 'Tue, 20 Oct 2026 00:00:00 GMT' }, now),
    null
  )
  assert.equal(parseOpenCodeRetryAfter(null, now), null)
})

test('tracker shows a full limit until it resets', () => {
  let clock = now
  const tracker = new OpenCodeFreeLimitTracker(() => clock)
  assert.deepEqual(tracker.getRateLimits('host'), [])
  tracker.record('host', { resetsAt: now + 60_000 })
  // A later retry without a time keeps the server's reset time.
  tracker.record('host', { resetsAt: null })
  const [limit] = tracker.getRateLimits('host')
  assert.deepEqual(
    [limit.id, limit.usedPercent, limit.windowMinutes, limit.resetsAt],
    ['opencode_free', 100, 1_440, now + 60_000]
  )
  assert.deepEqual(tracker.getRateLimits('container'), [])
  clock = now + 60_000
  assert.deepEqual(tracker.getRateLimits('host'), [])
})

test('a later successful OpenCode Zen reply clears a limit without a reset time', () => {
  let clock = now
  const tracker = new OpenCodeFreeLimitTracker(() => clock)
  tracker.record('host', { resetsAt: null })
  const reply = (providerID, completed, error) => ({
    role: 'assistant',
    providerID,
    time: { created: completed - 10, completed },
    ...(error ? { error } : {})
  })
  tracker.recordMessage('host', reply('opencode', now - 5))
  tracker.recordMessage('host', reply('anthropic', now + 5))
  tracker.recordMessage('host', reply('opencode', now + 5, { name: 'APIError' }))
  assert.equal(tracker.getRateLimits('host').length, 1)
  clock = now + 10
  tracker.recordMessage('host', reply('opencode', now + 5))
  assert.deepEqual(tracker.getRateLimits('host'), [])
})
