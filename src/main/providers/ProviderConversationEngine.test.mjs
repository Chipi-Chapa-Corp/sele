import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendProviderConversationSegment,
  assertUniqueProviderSnapshotIds,
  reconcileProviderRecords
} from './ProviderConversationEngine.ts'

test('projects provider-neutral entries into one working step and one final response', () => {
  const items = []
  appendProviderConversationSegment(items, {
    id: 'turn:working',
    entries: [
      {
        kind: 'assistant',
        message: {
          type: 'message',
          id: 'commentary',
          role: 'assistant',
          content: 'I am checking the implementation.'
        }
      },
      {
        kind: 'working',
        item: { type: 'tool', id: 'read', toolId: 'read', activity: 'read', status: 'completed' }
      },
      {
        kind: 'assistant',
        message: {
          type: 'message',
          id: 'final',
          role: 'assistant',
          content: 'The implementation is correct.'
        }
      }
    ],
    finalMessageIndex: 2,
    lifecycle: { completed: true }
  })

  assert.deepEqual(
    items.map((item) => `${item.type}:${item.id}`),
    ['working:turn:working', 'message:final']
  )
  assert.deepEqual(
    items[0].items.map((item) => `${item.type}:${item.id}`),
    ['message:commentary', 'tool:read']
  )
  assert.equal(items[0].status, 'worked')
})

test('can keep a tail step active while a provisional final response is visible', () => {
  const items = []
  appendProviderConversationSegment(items, {
    id: 'turn:working',
    entries: [
      {
        kind: 'assistant',
        message: { type: 'message', id: 'final', role: 'assistant', content: 'Provisional answer' }
      }
    ],
    lifecycle: { active: true },
    keepActiveAfterFinal: true
  })

  assert.equal(items[0].type, 'working')
  assert.equal(items[0].status, 'working')
  assert.equal(items[1].id, 'final')
})

test('reconciles authoritative records by identity while retaining live ephemerals', () => {
  const reconciled = reconcileProviderRecords(
    [
      { id: 'message', timestamp: 1, content: 'live placeholder' },
      { id: 'ephemeral', timestamp: 3, content: 'still running', ephemeral: true }
    ],
    [{ id: 'message', timestamp: 2, content: 'persisted message' }],
    {
      authoritative: true,
      getId: (record) => record.id,
      retainCurrent: (record) => record.ephemeral === true,
      compare: (first, second) => first.timestamp - second.timestamp
    }
  )

  assert.deepEqual(reconciled, [
    { id: 'message', timestamp: 2, content: 'persisted message' },
    { id: 'ephemeral', timestamp: 3, content: 'still running', ephemeral: true }
  ])
})

test('rejects duplicate snapshot identities at provider boundaries', () => {
  assert.throws(
    () => assertUniqueProviderSnapshotIds([{ id: 'same' }, { id: 'same' }], 'test snapshot'),
    /duplicate ID same/
  )
})
