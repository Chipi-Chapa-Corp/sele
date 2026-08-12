import assert from 'node:assert/strict'
import test from 'node:test'
import { mapClaudeRateLimits } from './ClaudeUsage.ts'

test('maps Claude limits to human-facing quota labels', () => {
  const limits = mapClaudeRateLimits({
    five_hour: { utilization: 26, resets_at: '2026-08-12T19:29:59.845951+00:00' },
    seven_day: { utilization: 6, resets_at: '2026-08-19T08:59:59.845973+00:00' },
    model_scoped: [{ display_name: 'Fable', utilization: 0, resets_at: null }]
  })

  assert.deepEqual(
    limits.map((limit) => [limit.id, limit.displayLabel, limit.usedPercent]),
    [
      ['five_hour', '5-hour limit', 26],
      ['seven_day', 'Weekly limit', 6],
      ['model_fable', 'Fable weekly limit', 0]
    ]
  )
})

test('omits Claude limits whose utilization is unavailable', () => {
  const limits = mapClaudeRateLimits({
    five_hour: { utilization: null, resets_at: null },
    seven_day: { utilization: 0, resets_at: null }
  })

  assert.deepEqual(
    limits.map((limit) => limit.id),
    ['seven_day']
  )
})

test('does not repeat a legacy model limit in model-scoped limits', () => {
  const limits = mapClaudeRateLimits({
    seven_day_opus: { utilization: 12, resets_at: null },
    model_scoped: [{ display_name: 'Opus', utilization: 12, resets_at: null }]
  })

  assert.deepEqual(
    limits.map((limit) => limit.id),
    ['seven_day_opus']
  )
})
