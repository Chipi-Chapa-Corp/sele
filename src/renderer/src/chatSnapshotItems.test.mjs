import assert from 'node:assert/strict'
import test from 'node:test'
import { reuseChatSnapshotItems } from './chatSnapshotItems.ts'

const message = (id, content) => ({ id, type: 'message', role: 'assistant', content })
const detail = (items, extra = {}) => ({ id: 'chat', items, ...extra })

test('IPC refreshes retain unchanged items without retaining stale metadata', () => {
  const old = detail([message('a', 'First'), message('b', 'Second')], { revision: 1 })
  const copy = structuredClone(old)
  copy.revision = 2
  copy.title = 'Updated title'
  const result = reuseChatSnapshotItems(old, copy)
  assert.equal(result.items, old.items)
  assert.equal(result.revision, 2)
  assert.equal(result.title, 'Updated title')
})

test('edits, order, insertion, removal and loaded payloads remain authoritative', () => {
  const old = detail([message('a', 'First'), message('b', 'Second')])
  const edited = detail([message('b', 'Edited'), message('a', 'First'), message('c', 'Third')])
  const result = reuseChatSnapshotItems(old, edited)
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['b', 'a', 'c']
  )
  assert.equal(result.items[0], edited.items[0])
  assert.equal(result.items[1], old.items[0])
  const removed = reuseChatSnapshotItems(old, detail([message('b', 'Second')]))
  assert.deepEqual(removed.items, [old.items[1]])
  const unloaded = detail([{ ...old.items[0], contentLoaded: false }])
  assert.equal(reuseChatSnapshotItems(old, unloaded).items[0], unloaded.items[0])
  const other = { ...edited, id: 'other' }
  assert.equal(reuseChatSnapshotItems(old, other), other)
})

test('nested tool changes render, while equivalent payloads reuse the old working step', () => {
  const old = detail([
    {
      id: 'step',
      type: 'working',
      status: 'working',
      items: [{ id: 'tool', stdout: 'x'.repeat(1_000_000), rawInput: { args: ['a', 'b'] } }]
    }
  ])
  assert.equal(reuseChatSnapshotItems(old, structuredClone(old)).items, old.items)
  const next = structuredClone(old)
  next.items[0].items[0].rawInput.args.push('c')
  assert.equal(reuseChatSnapshotItems(old, next).items[0], next.items[0])
})

test('exotic values and bounded comparison never claim unequal payloads are equal', () => {
  const old = detail([{ ...message('a', 'Test'), rawInput: new Map([['key', 'old']]) }])
  const next = structuredClone(old)
  next.items[0].rawInput.set('key', 'new')
  assert.equal(reuseChatSnapshotItems(old, next).items[0], next.items[0])
  const big = detail([
    { ...message('a', 'Test'), rawInput: Array.from({ length: 30000 }, (_, i) => i) }
  ])
  const copy = structuredClone(big)
  assert.equal(reuseChatSnapshotItems(big, copy).items[0], copy.items[0])
})

test('exhausting the tool comparison budget still reuses unchanged messages after it', () => {
  const old = detail([
    {
      id: 'step',
      type: 'working',
      status: 'worked',
      items: [{ id: 'tool', rawOutput: Array.from({ length: 8000 }, (_, i) => ({ i, value: i })) }]
    },
    message('answer', 'A long answer '.repeat(10000)),
    message('edited', 'Before')
  ])
  const next = structuredClone(old)
  next.items[2].content = 'After'
  const result = reuseChatSnapshotItems(old, next)
  assert.ok(result.items[0] === next.items[0], 'oversized payload comparison stays bounded')
  assert.ok(
    result.items[1] === old.items[1],
    'the payload must not invalidate the following answer'
  )
  assert.ok(result.items[2] === next.items[2], 'edited text is still authoritative')
})
