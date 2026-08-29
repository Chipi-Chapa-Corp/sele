import assert from 'node:assert/strict'
import test from 'node:test'
import { getCodexEditHistoryMutation } from './CodexThreadHistory.ts'

test('reverts paginated history from the edited turn id', () => {
  assert.deepEqual(getCodexEditHistoryMutation('thread', 'paginated', 'turn-three', 2), {
    method: 'thread/revert',
    params: {
      threadId: 'thread',
      beforeTurnId: 'turn-three'
    }
  })
})

test('rolls legacy history back by turn count', () => {
  assert.deepEqual(getCodexEditHistoryMutation('thread', 'legacy', 'turn-three', 2), {
    method: 'thread/rollback',
    params: {
      threadId: 'thread',
      numTurns: 2
    }
  })
})

test('treats an absent history mode as legacy for older Codex versions', () => {
  assert.equal(
    getCodexEditHistoryMutation('thread', undefined, 'turn-three', 2).method,
    'thread/rollback'
  )
})
