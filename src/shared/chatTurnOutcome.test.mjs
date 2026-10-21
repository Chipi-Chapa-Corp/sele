import assert from 'node:assert/strict'
import test from 'node:test'
import { getLastTurnOutcome } from './chatTurnOutcome.ts'

const turn = (id, status) => [
  { type: 'message', id: `${id}-user`, role: 'user', content: 'Continue' },
  { type: 'working', id: `${id}-work`, status, items: [] },
  { type: 'message', id: `${id}-assistant`, role: 'assistant', content: 'Response' }
]
const detail = (items, extra = {}) => ({ status: null, items, ...extra })

test('only the latest turn determines the reminder', () => {
  for (const outcome of ['failed', 'stopped']) {
    const items = turn('first', outcome)
    assert.equal(getLastTurnOutcome(detail(items)), outcome)
    for (const status of ['worked', 'working']) {
      assert.equal(getLastTurnOutcome(detail([...items, ...turn('next', status)])), null)
    }
    assert.equal(getLastTurnOutcome(detail([...items, turn('next', 'working')[0]])), null)
    assert.equal(getLastTurnOutcome(detail([...items, ...turn('next', 'stopped')])), 'stopped')
  }
  assert.equal(getLastTurnOutcome(detail([])), null)
})

test('a failed submission before work starts is still an error, while completed work clears stale errors', () => {
  assert.equal(
    getLastTurnOutcome(detail([turn('latest', 'working')[0]], { status: 'error' })),
    'failed'
  )
  assert.equal(getLastTurnOutcome(detail(turn('latest', 'worked'), { status: 'error' })), null)
})

test('queued messages do not resolve a stopped or failed turn', () => {
  for (const outcome of ['stopped', 'failed']) {
    assert.equal(
      getLastTurnOutcome(
        detail([
          ...turn('latest', outcome),
          { type: 'pendingMessage', id: 'queued', kind: 'queued', content: 'Later' }
        ])
      ),
      outcome
    )
  }
})

test('active work and requests for user action take precedence over terminal history', () => {
  for (const extra of [
    { status: 'active' },
    { pendingApproval: { id: 'approval' } },
    { pendingUserInput: { id: 'question' } }
  ]) {
    assert.equal(getLastTurnOutcome(detail(turn('old', 'failed'), extra)), null)
  }
})

test('older numbered and cursor windows cannot overwrite the latest outcome', () => {
  const items = turn('old', 'failed')
  assert.equal(
    getLastTurnOutcome(detail(items, { itemsStartTurnIndex: 0, turnCount: 2 })),
    undefined
  )
  assert.equal(
    getLastTurnOutcome(detail(items, { itemsStartTurnIndex: 1, turnCount: 2 })),
    'failed'
  )
  assert.equal(
    getLastTurnOutcome(
      detail(items, {
        turnPagination: { kind: 'cursor', olderCursor: null, newerCursor: 'next' }
      })
    ),
    undefined
  )
  assert.equal(
    getLastTurnOutcome(
      detail(items, {
        turnPagination: { kind: 'cursor', olderCursor: 'older', newerCursor: null }
      })
    ),
    'failed'
  )
})
