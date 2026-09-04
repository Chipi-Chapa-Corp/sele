import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendProviderConversationSegment,
  assertUniqueProviderSnapshotIds,
  ProviderConversationCompletionCoordinator,
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

test('keeps a tail step active while a provisional final response is visible', () => {
  const items = []
  appendProviderConversationSegment(items, {
    id: 'turn:working',
    entries: [
      {
        kind: 'assistant',
        message: { type: 'message', id: 'final', role: 'assistant', content: 'Provisional answer' }
      }
    ],
    lifecycle: { active: true }
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

test('publishes a provider completion before starting recovery reconciliation', async () => {
  const coordinator = new ProviderConversationCompletionCoordinator()
  const operations = []

  const completion = coordinator.complete('chat', {
    publish: () => operations.push('publish'),
    reconcile: async () => {
      operations.push('reconcile:start')
      await Promise.resolve()
      operations.push('reconcile:end')
    },
    publishReconciled: () => operations.push('publish:reconciled')
  })

  assert.deepEqual(operations, ['publish'])
  const published = await completion

  assert.equal(published, true)
  assert.deepEqual(operations, [
    'publish',
    'reconcile:start',
    'reconcile:end',
    'publish:reconciled'
  ])
})

test('does not publish stale reconciliation after a newer turn starts', async () => {
  const coordinator = new ProviderConversationCompletionCoordinator()
  let releaseReconciliation
  const reconciliation = new Promise((resolve) => {
    releaseReconciliation = resolve
  })
  const publications = []

  const completion = coordinator.complete('chat', {
    reconcile: () => reconciliation,
    publish: () => publications.push('terminal'),
    publishReconciled: () => publications.push('reconciled')
  })
  await Promise.resolve()
  coordinator.cancel('chat')
  releaseReconciliation()

  assert.equal(await completion, true)
  assert.deepEqual(publications, ['terminal'])
})

test('keeps the terminal snapshot visible when recovery reconciliation fails', async () => {
  const coordinator = new ProviderConversationCompletionCoordinator()
  const errors = []
  const publications = []

  const didPublish = await coordinator.complete('chat', {
    reconcile: async () => {
      throw new Error('history is temporarily unavailable')
    },
    publish: () => publications.push('terminal'),
    publishReconciled: () => publications.push('reconciled'),
    onError: (error, phase) => errors.push([phase, error.message])
  })

  assert.equal(didPublish, true)
  assert.deepEqual(publications, ['terminal'])
  assert.deepEqual(errors, [['reconcile', 'history is temporarily unavailable']])
})
