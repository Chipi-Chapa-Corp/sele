import assert from 'node:assert/strict'
import test from 'node:test'
import { getOpenCodeUsageLimitMessage } from './OpenCodeUsageLimit.ts'

test('provider limits are terminal whether reported as retry status or errors', () => {
  for (const message of [
    'Free usage exceeded',
    'Rate limit exceeded. Please try again later.',
    'Too Many Requests',
    'You have exceeded your current quota',
    'insufficient_quota',
    'Credit balance is too low: insufficient credits',
    'Out of credits',
    'You’ve hit your limit · resets 5pm (UTC)',
    'Credit balance is too low',
    'Your usage limit has been reached',
    'HTTP 429'
  ]) {
    const retry = { status: { type: 'retry', message } }
    const error = { name: 'APIError', data: { message, isRetryable: true } }
    for (const [type, properties] of [
      ['session.status', retry],
      ['session.error', { error }],
      ['message.updated', { info: { role: 'assistant', error } }]
    ]) {
      assert.match(getOpenCodeUsageLimitMessage(type, properties), /usage limit reached/i, message)
    }
  }
})

test('typed limits, response bodies, and status codes work without a descriptive message', () => {
  for (const [type, properties] of [
    ['session.status', { status: { type: 'retry', action: { reason: 'free_tier_limit' } } }],
    ['session.error', { error: { type: 'provider.free-limit' } }],
    ['session.error', { error: { name: 'APIError', data: { statusCode: 429 } } }],
    ['session.error', { error: { data: { responseBody: '{"code":"insufficient_quota"}' } } }]
  ]) {
    assert.match(getOpenCodeUsageLimitMessage(type, properties), /usage limit reached/i)
  }
})

test('ordinary transient retries and non-usage limits keep their existing behavior', () => {
  for (const message of [
    'Overloaded',
    'fetch failed',
    'HTTP 503',
    'Context length limit exceeded'
  ]) {
    assert.equal(
      getOpenCodeUsageLimitMessage('session.status', { status: { type: 'retry', message } }),
      null
    )
  }
  assert.equal(
    getOpenCodeUsageLimitMessage('message.updated', { info: { role: 'assistant', text: '429' } }),
    null
  )
  assert.equal(getOpenCodeUsageLimitMessage('session.idle', {}), null)
})
