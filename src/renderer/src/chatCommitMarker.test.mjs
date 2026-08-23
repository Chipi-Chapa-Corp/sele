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

test('renders a provider limit failure as failed instead of stopped', () => {
  assert.equal(getChatCommitMarkerTerminalStatus(detail(null, 'failed')), 'failed')
  assert.equal(getRecoveredChatCommitMarkerTerminalStatus(detail(null, 'failed')), 'failed')
})

test('distinguishes a shutdown-interrupted AI commit during recovery', () => {
  assert.equal(getRecoveredChatCommitMarkerTerminalStatus(detail(null, 'stopped')), 'interrupted')
})

test('preserves unambiguous terminal statuses during recovery', () => {
  assert.equal(getRecoveredChatCommitMarkerTerminalStatus(detail('error', 'worked')), 'failed')
  assert.equal(getRecoveredChatCommitMarkerTerminalStatus(detail(null, 'worked')), 'finished')
})
