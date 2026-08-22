import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getChatCommitMarkerTerminalStatus,
  getRecoveredChatCommitMarkerTerminalStatus
} from './chatCommitMarker.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const detail = (status, workingStatus) => ({
  status,
  items: [{ type: 'working', id: 'working', status: workingStatus, items: [] }]
})

test('preserves stopped status for a live AI commit cancellation', () => {
  assert.equal(getChatCommitMarkerTerminalStatus(detail(null, 'stopped')), 'stopped')
})

test('marks a shutdown-interrupted AI commit as failed during recovery', () => {
  assert.equal(getRecoveredChatCommitMarkerTerminalStatus(detail(null, 'stopped')), 'failed')
})

test('preserves unambiguous terminal statuses during recovery', () => {
  assert.equal(getRecoveredChatCommitMarkerTerminalStatus(detail('error', 'worked')), 'failed')
  assert.equal(getRecoveredChatCommitMarkerTerminalStatus(detail(null, 'worked')), 'finished')
})
