import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isCodexTurnTerminal,
  isMatchingCodexPendingTurn,
  mergeCodexStreamedText,
  mergeCodexTurnStatus,
  reconcileCodexTurnSnapshots,
  shouldPreferCodexRolloutItems
} from './CodexLiveMerge.ts'

test('keeps complete streamed text when a terminal snapshot is a shorter prefix', () => {
  assert.equal(
    mergeCodexStreamedText('The complete queued response.', 'The complete'),
    'The complete queued response.'
  )
  assert.equal(mergeCodexStreamedText('Complete response', ''), 'Complete response')
})

test('accepts snapshots that extend or correct the streamed text', () => {
  assert.equal(
    mergeCodexStreamedText('The response', 'The response is complete'),
    'The response is complete'
  )
  assert.equal(mergeCodexStreamedText('Draft response', 'Final response'), 'Final response')
})

test('uses whichever snapshot exists', () => {
  assert.equal(mergeCodexStreamedText(undefined, 'Response'), 'Response')
  assert.equal(mergeCodexStreamedText('Response', undefined), 'Response')
})

test('does not regress a completed turn to a late in-progress snapshot', () => {
  const completed = { status: 'completed', completedAt: 10 }
  const lateStart = { status: 'inProgress', completedAt: null }

  assert.equal(mergeCodexTurnStatus(completed, lateStart), 'completed')
})

test('accepts forward lifecycle transitions and newer terminal states', () => {
  assert.equal(mergeCodexTurnStatus({ status: 'inProgress' }, { status: 'completed' }), 'completed')
  assert.equal(mergeCodexTurnStatus({ status: 'failed' }, { status: 'interrupted' }), 'interrupted')
  assert.equal(
    mergeCodexTurnStatus({ status: 'inProgress' }, { status: null, completedAt: 10 }),
    null
  )
})

test('recognizes history turns with a completion timestamp as terminal', () => {
  assert.equal(isCodexTurnTerminal({ status: null, completedAt: 10 }), true)
  assert.equal(isCodexTurnTerminal({ status: null, completedAt: null }), false)
})

test('applies an already-received real turn after the pending and start snapshots', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const merge = (previous, next) => ({
    status: mergeCodexTurnStatus(previous, next),
    events: [...previous.events, ...next.events]
  })
  const turn = reconcileCodexTurnSnapshots(
    { status: 'inProgress', events: ['pending'] },
    { status: 'inProgress', events: ['start'] },
    { status: 'completed', events: ['completion'] },
    merge
  )

  assert.deepEqual(turn, {
    status: 'completed',
    events: ['pending', 'start', 'completion']
  })
})

test('a late reply cannot clear the pending id of the next queued turn', () => {
  assert.equal(isMatchingCodexPendingTurn('queued:next', 'pending:previous'), false)
  assert.equal(isMatchingCodexPendingTurn('queued:next', 'queued:next'), true)
})

test('restart history restores a user message omitted from the structured turn', () => {
  assert.equal(
    shouldPreferCodexRolloutItems({
      structuredToolCount: 0,
      rolloutToolCount: 0,
      structuredTextCount: 1,
      rolloutTextCount: 2
    }),
    true
  )
})
