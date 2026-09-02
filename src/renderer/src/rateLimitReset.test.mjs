import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatRateLimitResetExpirationDate,
  groupRateLimitResetCreditsByExpiration
} from './rateLimitReset.ts'

test('groups reset credits by local expiration date and sorts them chronologically', () => {
  const firstDate = new Date(2030, 0, 2, 9).getTime() / 1_000
  const sameDate = new Date(2030, 0, 2, 18).getTime() / 1_000
  const nextDate = new Date(2030, 0, 3, 9).getTime() / 1_000

  assert.deepEqual(
    groupRateLimitResetCreditsByExpiration([
      { id: 'next', expiresAt: nextDate },
      { id: 'first', expiresAt: firstDate },
      { id: 'same', expiresAt: sameDate },
      { id: 'none', expiresAt: null }
    ]),
    [
      { expiresAt: firstDate, count: 2 },
      { expiresAt: nextDate, count: 1 },
      { expiresAt: null, count: 1 }
    ]
  )
})

test('returns no groups when reset details are unavailable', () => {
  assert.deepEqual(groupRateLimitResetCreditsByExpiration(null), [])
})

test('labels reset credits without an expiration date', () => {
  assert.equal(formatRateLimitResetExpirationDate(null), 'No expiration')
})
