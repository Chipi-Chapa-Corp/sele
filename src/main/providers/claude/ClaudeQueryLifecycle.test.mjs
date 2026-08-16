import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldKeepClaudeQueryAliveAfterResult } from './ClaudeQueryLifecycle.ts'

test('keeps the Claude query alive while background subagents are running', () => {
  assert.equal(shouldKeepClaudeQueryAliveAfterResult(2, 'completed'), true)
})

test('keeps the Claude query alive when the result requests background execution', () => {
  assert.equal(shouldKeepClaudeQueryAliveAfterResult(0, 'background_requested'), true)
})

test('closes the Claude query after all work finishes', () => {
  assert.equal(shouldKeepClaudeQueryAliveAfterResult(0, 'completed'), false)
})
