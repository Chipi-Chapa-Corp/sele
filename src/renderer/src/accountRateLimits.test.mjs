import assert from 'node:assert/strict'
import test from 'node:test'
import { groupAccountRateLimits } from './accountRateLimits.ts'

const rateLimits = [
  {
    id: 'five_hour',
    label: 'Claude',
    kind: 'primary',
    usedPercent: 20,
    windowMinutes: 300,
    resetsAt: null
  },
  {
    id: 'seven_day',
    label: 'Claude',
    kind: 'secondary',
    usedPercent: 30,
    windowMinutes: 10_080,
    resetsAt: null
  },
  {
    id: 'model_fable',
    label: 'Fable',
    usageScope: 'fable',
    kind: 'secondary',
    usedPercent: 40,
    windowMinutes: 10_080,
    resetsAt: null
  }
]

test('uses a selected model quota in place of the global weekly quota', () => {
  const grouped = groupAccountRateLimits(rateLimits, 'fable')

  assert.deepEqual(
    grouped.visibleRateLimits.map((limit) => limit.id),
    ['five_hour', 'model_fable']
  )
  assert.deepEqual(
    grouped.detailedRateLimits.map((limit) => limit.id),
    ['seven_day']
  )
})

test('keeps the global weekly quota when the selected model has no scoped quota', () => {
  const grouped = groupAccountRateLimits(rateLimits, 'opus')

  assert.deepEqual(
    grouped.visibleRateLimits.map((limit) => limit.id),
    ['five_hour', 'seven_day']
  )
  assert.deepEqual(
    grouped.detailedRateLimits.map((limit) => limit.id),
    ['model_fable']
  )
})
