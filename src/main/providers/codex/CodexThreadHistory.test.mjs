import assert from 'node:assert/strict'
import test from 'node:test'
import { findCodexUserMessageTurnIndex, getCodexEditHistoryMutation } from './CodexThreadHistory.ts'

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

test('finds an editable user message by its exact renderer id', () => {
  const turns = [
    { id: 'turn-one', items: [{ type: 'userMessage', id: 'item-one' }] },
    { id: 'turn-two', items: [{ type: 'userMessage', id: 'item-two' }] }
  ]

  assert.equal(findCodexUserMessageTurnIndex(turns, 'turn-two:item-two'), 1)
})

test('finds the user turn when rehydration changed the message item id', () => {
  const turns = [{ id: 'turn-one', items: [{ type: 'userMessage', id: 'authoritative-item' }] }]

  assert.equal(findCodexUserMessageTurnIndex(turns, 'turn-one:stale-local-item'), 0)
})

test('does not use a turn-id fallback for an assistant-only turn', () => {
  const turns = [{ id: 'turn-one', items: [{ type: 'agentMessage', id: 'assistant-item' }] }]

  assert.equal(findCodexUserMessageTurnIndex(turns, 'turn-one:stale-item'), -1)
})

test('rejects an ambiguous turn-id fallback', () => {
  const turns = [
    { id: 'turn', items: [{ type: 'userMessage', id: 'item-one' }] },
    { id: 'turn:child', items: [{ type: 'userMessage', id: 'item-two' }] }
  ]

  assert.equal(findCodexUserMessageTurnIndex(turns, 'turn:child:stale-item'), -1)
})
