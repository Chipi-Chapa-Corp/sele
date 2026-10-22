import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getUnchangedTranscriptPrefix,
  indexTranscriptRecords,
  updateIndexedTranscriptRecord
} from './recordChanges.ts'
import { updateIndexedTranscriptRecords } from './recordChanges.ts'
import { BufferedSnapshotMap } from './BufferedSnapshotMap.ts'

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

test('a burst copies a huge record array once and retains immutable branches and provenance', () => {
  const initial = Array.from({ length: 100_000 }, (_, index) => ({ id: String(index) }))
  let copies = 0
  Object.defineProperty(initial, 'slice', {
    value: (...args) => {
      copies++
      return Array.prototype.slice.apply(initial, args)
    }
  })
  const updates = Array.from({ length: 100 }, (_, index) => ({
    id: `new-${index}`,
    update: () => ({ id: `new-${index}` })
  }))
  updates.push({ id: '5', update: (previous) => ({ ...previous, text: 'changed' }) })
  const result = updateIndexedTranscriptRecords(initial, updates)
  assert.equal(copies, 1)
  assert.equal(result.length, 100_100)
  assert.equal(initial.length, 100_000)
  assert.equal(getUnchangedTranscriptPrefix(initial, result), 5)
  assert.equal(indexTranscriptRecords(initial).size, 100_000)
  const branch = updateIndexedTranscriptRecords(initial, [
    { id: 'new-0', update: () => ({ id: 'new-0', branch: true }) }
  ])
  assert.equal(branch.at(-1).branch, true)
  assert.equal(result[100_000].branch, undefined)
})

test('buffered snapshots flush for reads, iteration and replacement, and discard deleted work', () => {
  let reductions = 0
  const store = new BufferedSnapshotMap((records, updates) => {
    reductions++
    return updateIndexedTranscriptRecords(records, updates)
  })
  const initial = [{ id: 'a', text: '' }]
  store.set('chat', initial)
  for (let index = 0; index < 100; index++)
    store.enqueue('chat', { id: 'a', update: (item) => ({ ...item, text: item.text + 'x' }) })
  assert.equal(reductions, 0)
  const published = store.get('chat')
  assert.equal(reductions, 1)
  assert.equal(published[0].text.length, 100)
  assert.equal(initial[0].text, '')
  store.enqueue('chat', { id: 'b', update: () => ({ id: 'b' }) })
  assert.equal([...store.values()][0].length, 2)
  assert.equal(published.length, 1)
  store.enqueue('chat', { id: 'c', update: () => ({ id: 'c' }) })
  store.set('chat', initial)
  assert.equal(reductions, 3)
  store.enqueue('chat', { id: 'lost', update: () => assert.fail('deleted work applied') })
  store.delete('chat')
  assert.equal(store.get('chat'), undefined)
})
