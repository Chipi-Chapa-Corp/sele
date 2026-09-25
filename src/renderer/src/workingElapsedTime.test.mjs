import assert from 'node:assert/strict'
import test from 'node:test'
import { formatWorkingDuration, getWorkingElapsedTime } from './workingElapsedTime.ts'

test('elapsed labels omit zero units and never show invalid or negative time', () => {
  for (const [milliseconds, expected] of [
    [0, ''],
    [999, ''],
    [-1000, ''],
    [NaN, ''],
    [Infinity, ''],
    [1000, '1s'],
    [60000, '1m'],
    [3600000, '1h'],
    [3605000, '1h 5s'],
    [3665000, '1h 1m 5s'],
    [90061000, '25h 1m 1s']
  ])
    assert.equal(formatWorkingDuration(milliseconds), expected)
})

test('active elapsed time follows the clock and completed sections freeze at their boundary', () => {
  const step = { status: 'working', startedAt: 1000 }
  assert.equal(getWorkingElapsedTime(step, 66000), '1m 5s')
  assert.equal(getWorkingElapsedTime(step, 67000), '1m 6s')
  const finished = { ...step, status: 'worked', completedAt: 66000 }
  assert.equal(getWorkingElapsedTime(finished, 500000), '1m 5s')
  assert.equal(getWorkingElapsedTime({ status: 'working' }, 500000), '')
  assert.equal(getWorkingElapsedTime({ ...step, status: 'worked' }, 500000), '')
  assert.equal(getWorkingElapsedTime({ ...step, status: 'queued' }, 500000), '')
})
