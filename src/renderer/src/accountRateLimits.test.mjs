import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldDisableRateLimitReset, sortRateLimitsForDisplay } from './accountRateLimits.ts'

// Test fixtures intentionally omit fields that are irrelevant to reset eligibility.
const rateLimit = (usedPercent) => ({
  id: 'codex',
  label: 'Codex',
  kind: 'primary',
  usedPercent,
  windowMinutes: 300,
  resetsAt: null
})

const resetCredit = (expiresAt) => ({ id: 'reset-credit', expiresAt })

test('shows the five-hour limit before a more-used weekly limit without changing usage priority', () => {
  const weekly = { ...rateLimit(90), kind: 'secondary', windowMinutes: 10_080 }
  const fiveHour = rateLimit(20)
  const limits = Object.freeze([weekly, fiveHour])

  assert.deepEqual(sortRateLimitsForDisplay(limits), [fiveHour, weekly])
  assert.deepEqual(limits, [weekly, fiveHour])
})

test('keeps equal windows stable and places unspecified windows last', () => {
  const unknown = { ...rateLimit(80), windowMinutes: null }
  const first = rateLimit(20)
  const second = rateLimit(50)

  assert.deepEqual(sortRateLimitsForDisplay([unknown, first, second]), [first, second, unknown])
  assert.deepEqual(sortRateLimitsForDisplay([]), [])
})

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
