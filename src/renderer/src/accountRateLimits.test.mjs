import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getUsageBadgeRateLimit,
  shouldDisableRateLimitReset,
  sortRateLimitsForDisplay
} from './accountRateLimits.ts'

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

test('short badge uses five-hour usage and stays absent when missing', () => {
  const weekly = { ...rateLimit(70), id: 'seven_day', windowMinutes: 10_080 }
  const short = rateLimit(20)

  assert.equal(getUsageBadgeRateLimit([weekly, short], 'short'), short)
  assert.equal(getUsageBadgeRateLimit([weekly], 'short'), null)
  assert.equal(getUsageBadgeRateLimit([], 'short'), null)
})

test('long badge prefers the main weekly limit over secondary weekly limits', () => {
  const secondary = {
    ...rateLimit(90),
    id: 'seven_day_opus',
    kind: 'secondary',
    windowMinutes: 10_080
  }
  const weekly = { ...rateLimit(30), id: 'seven_day', kind: 'secondary', windowMinutes: 10_080 }

  assert.equal(getUsageBadgeRateLimit([secondary, weekly], 'long'), weekly)
  const primary = { ...weekly, kind: 'primary', usedPercent: 20 }
  assert.equal(getUsageBadgeRateLimit([weekly, primary], 'long'), primary)
  const short = rateLimit(20)
  assert.equal(getUsageBadgeRateLimit([short], 'long'), null)
})

test('long badge uses monthly usage when weekly is absent', () => {
  const monthly = { ...rateLimit(45), id: 'monthly', windowMinutes: 43_200 }

  assert.equal(getUsageBadgeRateLimit([monthly], 'long'), monthly)
  assert.equal(getUsageBadgeRateLimit([], 'long'), null)
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

test('long badge uses the general weekly quota, with a monthly fallback but no short fallback', () => {
  const short = rateLimit(20)
  const weekly = { ...rateLimit(70), id: 'seven_day', windowMinutes: 10_080 }
  const scoped = { ...weekly, usageScope: 'opus', usedPercent: 99 }
  const monthly = { ...rateLimit(50), id: 'premium', windowMinutes: 43_200 }
  assert.equal(getUsageBadgeRateLimit([short, scoped, weekly, monthly], 'long'), weekly)
  assert.equal(getUsageBadgeRateLimit([short, monthly], 'long'), monthly)
  assert.equal(getUsageBadgeRateLimit([short], 'long'), null)
  assert.equal(getUsageBadgeRateLimit([], 'long'), null)
})

test('long badge can show reported account quotas with no window metadata', () => {
  const quota = { ...rateLimit(45), id: 'premium_interactions', windowMinutes: null }
  assert.equal(getUsageBadgeRateLimit([quota], 'long'), quota)
  assert.equal(getUsageBadgeRateLimit([quota], 'short'), null)
})
