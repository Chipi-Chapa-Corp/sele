import assert from 'node:assert/strict'
import test from 'node:test'
import { getModifiedActiveSendMode } from './messageSendMode.ts'

test('keeps queue as the default active send mode', () => {
  assert.equal(getModifiedActiveSendMode('queue', true, false), 'queue')
})

test('changes queue to steer while Control is pressed', () => {
  assert.equal(getModifiedActiveSendMode('queue', true, true), 'steer')
})

test('does not offer another steer when active steering is unavailable', () => {
  assert.equal(getModifiedActiveSendMode('queue', false, true), 'queue')
})

test('preserves an existing steer primary mode', () => {
  assert.equal(getModifiedActiveSendMode('steer', true, false), 'steer')
  assert.equal(getModifiedActiveSendMode('steer', true, true), 'steer')
})
