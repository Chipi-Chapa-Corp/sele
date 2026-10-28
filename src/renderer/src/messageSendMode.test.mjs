import assert from 'node:assert/strict'
import test from 'node:test'
import { getModifiedActiveSendMode } from './messageSendMode.ts'

test('holding Ctrl flips either default active action and releasing it restores the default', () => {
  for (const [defaultMode, alternateMode] of [
    ['queue', 'steer'],
    ['steer', 'queue']
  ]) {
    assert.equal(getModifiedActiveSendMode(defaultMode, true, false), defaultMode)
    assert.equal(getModifiedActiveSendMode(defaultMode, true, true), alternateMode)
    assert.equal(getModifiedActiveSendMode(defaultMode, true, false), defaultMode)
  }
})

test('Ctrl cannot select steering while another steering message is pending', () => {
  assert.equal(getModifiedActiveSendMode('queue', false, false), 'queue')
  assert.equal(getModifiedActiveSendMode('queue', false, true), 'queue')
})

test('switching from steer to queue does not require steering to be enabled', () => {
  assert.equal(getModifiedActiveSendMode('steer', false, true), 'queue')
})
