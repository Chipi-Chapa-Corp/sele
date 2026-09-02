import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldDisableRateLimitReset } from './accountRateLimits.ts'

// Test fixtures intentionally omit fields that are irrelevant to reset eligibility.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const rateLimit = (usedPercent) => ({
  id: 'codex',
  label: 'Codex',
  kind: 'primary',
  usedPercent,
  windowMinutes: 300,
  resetsAt: null
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const resetCredit = (expiresAt) => ({ id: 'reset-credit', expiresAt })

test('disables rate-limit resets when every limit has more than 5% left', () => {
  assert.equal(shouldDisableRateLimitReset([rateLimit(94)]), true)
  assert.equal(shouldDisableRateLimitReset([rateLimit(1), rateLimit(94.99)]), true)
})

test('allows rate-limit resets at exactly 5% left', () => {
  assert.equal(shouldDisableRateLimitReset([rateLimit(95)]), false)
})

test('allows a reset when any limit has at most 5% left', () => {
  assert.equal(shouldDisableRateLimitReset([rateLimit(4), rateLimit(96)]), false)
})

test('allows a reset when a reset credit expires within two days', () => {
  const now = Date.UTC(2026, 8, 2, 12)

  assert.equal(
    shouldDisableRateLimitReset([rateLimit(1)], [resetCredit(now + 2 * 24 * 60 * 60 * 1_000)], now),
    false
  )
  assert.equal(
    shouldDisableRateLimitReset(
      [rateLimit(1)],
      [resetCredit((now + 24 * 60 * 60 * 1_000) / 1_000)],
      now
    ),
    false
  )
})

test('does not allow an early reset for credits outside the next two days', () => {
  const now = Date.UTC(2026, 8, 2, 12)

  assert.equal(
    shouldDisableRateLimitReset(
      [rateLimit(1)],
      [resetCredit(now + 2 * 24 * 60 * 60 * 1_000 + 1)],
      now
    ),
    true
  )
  assert.equal(
    shouldDisableRateLimitReset([rateLimit(1)], [resetCredit(now - 1), resetCredit(null)], now),
    true
  )
})

test('does not disable resets when usage data is unavailable', () => {
  assert.equal(shouldDisableRateLimitReset([]), false)
})
