import assert from 'node:assert/strict'
import test from 'node:test'
import { PendingMessageEdits } from './PendingMessageEdits.ts'

const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('an edit holds the edited message and its successors, but not its predecessors', () => {
  const edits = new PendingMessageEdits()
  edits.begin('chat', 'b', 'edit', queue)
  assert.equal(edits.blocks('chat', 'a'), false)
  assert.equal(edits.blocks('chat', 'b'), true)
  assert.equal(edits.blocks('chat', 'c'), true)
  assert.equal(edits.blocks('chat', 'later'), true, 'messages queued during the edit wait')
  assert.equal(edits.blocks('chat', undefined), true)
  assert.equal(edits.blocks('other', 'c'), false)
})

test('the boundary is a snapshot that removing predecessors cannot move', () => {
  const edits = new PendingMessageEdits()
  const messages = [...queue]
  edits.begin('chat', 'c', 'edit', messages)
  messages.splice(0, 2)
  assert.equal(edits.blocks('chat', 'a'), false)
  assert.equal(edits.blocks('chat', 'b'), false)
  assert.equal(edits.blocks('chat', 'c'), true)
})

test('editing the head holds the whole queue', () => {
  const edits = new PendingMessageEdits()
  edits.begin('chat', 'a', 'edit', queue)
  for (const { id } of queue) assert.equal(edits.blocks('chat', id), true)
})

test('actions on predecessors stay allowed while successors are refused', () => {
  const edits = new PendingMessageEdits()
  edits.begin('chat', 'b', 'edit', queue)
  assert.doesNotThrow(() => edits.assert('chat', 'a'))
  assert.throws(() => edits.assert('chat', 'c'), /no longer active/)
  assert.doesNotThrow(() => edits.assert('chat', 'b', 'edit'))
  assert.throws(() => edits.assert('chat', 'b', 'stale'), /no longer active/)
  assert.throws(() => edits.begin('chat', 'a', 'next', queue), /Another pending message/)
  assert.equal(edits.release('chat', 'b', 'stale'), false)
  assert.equal(edits.release('chat', 'b', 'edit'), true)
  assert.equal(edits.blocks('chat', 'c'), false)
})
