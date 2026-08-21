import assert from 'node:assert/strict'
import test from 'node:test'
import { getClaudeQueueDrainDecision } from './ClaudeQueueDrain.ts'

const readyQueue = {
  hasQueuedMessage: true,
  paused: false,
  drainInProgress: false,
  foregroundActive: false,
  hasPendingRequest: false
}

test('starts the first queued Claude turn after foreground completion', () => {
  assert.equal(getClaudeQueueDrainDecision(readyQueue), 'start')
})

test('preserves a stopped Claude queue without starting it', () => {
  assert.equal(getClaudeQueueDrainDecision({ ...readyQueue, paused: true }), 'wait')
})

test('serializes Claude queue promotion', () => {
  assert.equal(getClaudeQueueDrainDecision({ ...readyQueue, drainInProgress: true }), 'wait')
})

test('waits while a foreground turn or user request is active', () => {
  assert.equal(getClaudeQueueDrainDecision({ ...readyQueue, foregroundActive: true }), 'wait')
  assert.equal(getClaudeQueueDrainDecision({ ...readyQueue, hasPendingRequest: true }), 'wait')
})

test('does nothing without a queued Claude message', () => {
  assert.equal(getClaudeQueueDrainDecision({ ...readyQueue, hasQueuedMessage: false }), 'wait')
})
