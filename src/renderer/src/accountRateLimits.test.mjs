import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldDisableRateLimitReset } from './accountRateLimits.ts'

// Test fixtures intentionally omit fields that are irrelevant to the threshold behavior.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const rateLimit = (usedPercent) => ({
  id: 'codex',
  label: 'Codex',
  kind: 'primary',
  usedPercent,
  windowMinutes: 300,
  resetsAt: null
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

test('does not disable resets when usage data is unavailable', () => {
  assert.equal(shouldDisableRateLimitReset([]), false)
})
