import assert from 'node:assert/strict'
import test from 'node:test'
import { getCodexQueueDrainDecision } from './CodexQueueDrain.ts'

const idleQueue = {
  hasQueuedTurn: true,
  drainInProgress: false,
  paused: false,
  threadStatus: 'idle',
  hasActiveTurn: false,
  hasPendingApproval: false
}

test('starts the first queued turn once the thread is idle', () => {
  assert.equal(getCodexQueueDrainDecision(idleQueue), 'start')
})

test('reconciles an authoritative idle thread that still has a cached active turn', () => {
  assert.equal(
    getCodexQueueDrainDecision({
      ...idleQueue,
      hasActiveTurn: true
    }),
    'reconcile'
  )
})

test('waits while the thread is active or waiting for user action', () => {
  assert.equal(
    getCodexQueueDrainDecision({
      ...idleQueue,
      threadStatus: 'active'
    }),
    'wait'
  )
  assert.equal(
    getCodexQueueDrainDecision({
      ...idleQueue,
      hasPendingApproval: true
    }),
    'wait'
  )
})

test('waits when queue promotion is paused or already serialized', () => {
  assert.equal(
    getCodexQueueDrainDecision({
      ...idleQueue,
      paused: true
    }),
    'wait'
  )
  assert.equal(
    getCodexQueueDrainDecision({
      ...idleQueue,
      drainInProgress: true
    }),
    'wait'
  )
})

test('does nothing without a queued turn', () => {
  assert.equal(
    getCodexQueueDrainDecision({
      ...idleQueue,
      hasQueuedTurn: false
    }),
    'wait'
  )
})
