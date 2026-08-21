import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getClaudeResultLifecycleDecision,
  getClaudeSessionStateLifecycleDecision
} from './ClaudeQueryLifecycle.ts'

test('keeps the Claude query alive while background subagents are running', () => {
  assert.deepEqual(getClaudeResultLifecycleDecision(2, 'completed'), {
    keepQueryAlive: true,
    waitForSessionIdle: true
  })
})

test('waits for authoritative idle when the result requests background execution', () => {
  const decision = getClaudeResultLifecycleDecision(0, 'background_requested')

  assert.deepEqual(decision, {
    keepQueryAlive: true,
    waitForSessionIdle: true
  })
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'idle', 0, false), 'complete')
})

test('closes the Claude query after all work finishes', () => {
  assert.deepEqual(getClaudeResultLifecycleDecision(0, 'completed'), {
    keepQueryAlive: false,
    waitForSessionIdle: false
  })
})

test('does not complete a held background result while the session is still running', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'running', 0, false), 'ignore')
})

test('ignores idle notifications when no background result is being held', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(false, 'idle', 0, false), 'ignore')
})

test('does not close a held query while background work is still running', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'idle', 1, false), 'ignore')
})

test('does not close a held query during a new foreground turn', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'idle', 0, true), 'ignore')
})

test('failed and stopped results never keep the query visibly or internally active', () => {
  assert.deepEqual(getClaudeResultLifecycleDecision(2, 'background_requested', true), {
    keepQueryAlive: false,
    waitForSessionIdle: false
  })
})
