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
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'idle', false, false), 'complete')
})

test('closes the Claude query after all work finishes', () => {
  assert.deepEqual(getClaudeResultLifecycleDecision(0, 'completed'), {
    keepQueryAlive: false,
    waitForSessionIdle: false
  })
})

test('does not complete a held background result while the session is still running', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'running', false, false), 'ignore')
})

test('ignores idle notifications when no background result is being held', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(false, 'idle', false, false), 'ignore')
})

test('sends a queued message when held background work becomes idle', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'idle', true, false), 'sendQueued')
})

test('does not send a queued message after a failed background result', () => {
  assert.equal(getClaudeSessionStateLifecycleDecision(true, 'idle', true, true), 'complete')
})
