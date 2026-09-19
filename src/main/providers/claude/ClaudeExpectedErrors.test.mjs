import assert from 'node:assert/strict'
import test from 'node:test'
import { isExpectedClaudeQueryShutdownError } from './ClaudeExpectedErrors.ts'

test('recognizes normal query shutdown races without masking unrelated failures', () => {
  assert.equal(isExpectedClaudeQueryShutdownError(new Error('Query is closed')), true)
  assert.equal(isExpectedClaudeQueryShutdownError(new DOMException('Aborted', 'AbortError')), true)
  assert.equal(isExpectedClaudeQueryShutdownError(new Error('Permission denied')), false)
})
