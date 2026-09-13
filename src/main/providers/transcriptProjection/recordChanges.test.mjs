import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getUnchangedTranscriptPrefix,
  indexTranscriptRecords,
  updateIndexedTranscriptRecord
} from './recordChanges.ts'

test('indexed updates retain provenance across a batched append and replacement', () => {
  const initial = [{ id: 'a' }, { id: 'b' }]
  const appended = updateIndexedTranscriptRecord(initial, 'c', () => ({ id: 'c' }))
  const replaced = updateIndexedTranscriptRecord(appended, 'b', (item) => ({
    ...item,
    text: 'new'
  }))
  assert.equal(getUnchangedTranscriptPrefix(initial, replaced), 1)
  assert.equal(getUnchangedTranscriptPrefix(initial, initial.slice()), 0)
  assert.deepEqual(initial, [{ id: 'a' }, { id: 'b' }])
})

test('indexed snapshots remain independent when updates branch from older history', () => {
  const initial = [{ id: 'a' }]
  const first = updateIndexedTranscriptRecord(initial, 'b', () => ({ id: 'b' }))
  const second = updateIndexedTranscriptRecord(initial, 'c', () => ({ id: 'c' }))
  const updated = updateIndexedTranscriptRecord(first, 'b', (item) => ({
    ...item,
    text: 'updated'
  }))
  assert.deepEqual(updated, [{ id: 'a' }, { id: 'b', text: 'updated' }])
  assert.deepEqual(second, [{ id: 'a' }, { id: 'c' }])
  assert.throws(() => indexTranscriptRecords([{ id: 'a' }, { id: 'a' }]), /duplicate/)
  assert.throws(() => updateIndexedTranscriptRecord(first, 'b', () => ({ id: 'c' })), /identity/)
})
