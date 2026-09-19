import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertCodexHistoryWritable,
  getUnsupportedCodexHistoryMessage,
  loadCodexLegacyThread,
  loadCodexTurnCursorWindow,
  retainCodexTurnTail,
  retryCodexEmptyRolloutRead
} from './CodexPaginatedHistory.ts'

// Test fixtures intentionally omit production-only Codex fields.
const turn = (id) => ({ id, status: 'completed', items: [] })

test('retries only the transient empty-rollout initialization failure', async () => {
  let reads = 0
  const retries = []
  const result = await retryCodexEmptyRolloutRead(
    async () => {
      reads += 1
      if (reads < 3) {
        throw new Error(
          'failed to read thread: failed to read session metadata /tmp/rollout.jsonl: rollout at /tmp/rollout.jsonl is empty'
        )
      }
      return 'loaded'
    },
    {
      delay: async () => {},
      onRetry: (_error, attempt, attempts) => retries.push([attempt, attempts])
    }
  )

  assert.equal(result, 'loaded')
  assert.equal(reads, 3)
  assert.deepEqual(retries, [
    [1, 3],
    [2, 3]
  ])
})

test('does not retry unrelated Codex read errors', async () => {
  let reads = 0
  await assert.rejects(
    retryCodexEmptyRolloutRead(async () => {
      reads += 1
      throw new Error('permission denied')
    }),
    /permission denied/
  )
  assert.equal(reads, 1)
})

test('stops empty-rollout retries at the configured boundary and reports the final failure', async () => {
  const expectedError = new Error(
    'failed to read session metadata /tmp/rollout.jsonl: rollout at /tmp/rollout.jsonl is empty'
  )
  let reads = 0
  const retries = []
  const failures = []
  await assert.rejects(
    retryCodexEmptyRolloutRead(
      async () => {
        reads += 1
        throw expectedError
      },
      {
        attempts: 3,
        delay: async () => {},
        onRetry: (error, attempt) => retries.push([error, attempt]),
        onFinalFailure: (error, attempts) => failures.push([error, attempts])
      }
    ),
    (error) => error === expectedError
  )

  assert.equal(reads, 3)
  assert.deepEqual(retries, [
    [expectedError, 1],
    [expectedError, 2]
  ])
  assert.deepEqual(failures, [[expectedError, 3]])
})

test('reports missing history metadata without labeling it legacy', () => {
  assert.match(getUnsupportedCodexHistoryMessage(undefined), /does not report/i)
  assert.doesNotMatch(getUnsupportedCodexHistoryMessage(undefined), /legacy/i)
})

test('loads legacy history with the supported full-thread read contract', async () => {
  const requests = []
  const thread = await loadCodexLegacyThread(async (method, params) => {
    requests.push({ method, params })
    return {
      thread: {
        id: 'legacy-thread',
        historyMode: 'legacy',
        turns: [turn('one'), turn('two')]
      }
    }
  }, 'legacy-thread')

  assert.deepEqual(
    thread.turns.map(({ id }) => id),
    ['one', 'two']
  )
  assert.deepEqual(requests, [
    {
      method: 'thread/read',
      params: { threadId: 'legacy-thread', includeTurns: true }
    }
  ])
})

test('keeps legacy history mutations disabled', () => {
  assert.throws(() => assertCodexHistoryWritable('legacy'), /read-only/i)
  assert.doesNotThrow(() => assertCodexHistoryWritable('paginated'))
})

test('loads the latest cursor page without counting earlier turns', async () => {
  const requests = []
  const page = await loadCodexTurnCursorWindow(
    async (method, params) => {
      requests.push({ method, params })
      return {
        data: [turn('newest'), turn('older')],
        nextCursor: 'next-older',
        backwardsCursor: 'unused-latest-boundary'
      }
    },
    'thread',
    { cursor: null, direction: 'older', limit: 2 }
  )

  assert.deepEqual(
    page.turns.map(({ id }) => id),
    ['older', 'newest']
  )
  assert.ok(page.olderCursor)
  assert.equal(page.newerCursor, null)
  assert.deepEqual(requests, [
    {
      method: 'thread/turns/list',
      params: {
        threadId: 'thread',
        cursor: null,
        limit: 2,
        sortDirection: 'desc',
        itemsView: 'full'
      }
    }
  ])
})

test('reverses cursor direction without repeating the anchor turn', async () => {
  const olderPage = await loadCodexTurnCursorWindow(
    async () => ({
      data: [turn('four'), turn('three')],
      nextCursor: 'older-boundary',
      backwardsCursor: 'newer-with-anchor'
    }),
    'thread',
    {
      cursor: 'sele:codex-turn-cursor:{"cursor":"page","anchorTurnId":null}',
      direction: 'older',
      limit: 2
    }
  )

  const requests = []
  const newerPage = await loadCodexTurnCursorWindow(
    async (method, params) => {
      requests.push({ method, params })
      return {
        data: [turn('four'), turn('five'), turn('six')],
        nextCursor: null,
        backwardsCursor: 'older-with-anchor'
      }
    },
    'thread',
    { cursor: olderPage.newerCursor, direction: 'newer', limit: 2 }
  )

  assert.deepEqual(
    newerPage.turns.map(({ id }) => id),
    ['five', 'six']
  )
  assert.equal(requests[0].params.cursor, 'newer-with-anchor')
  assert.equal(requests[0].params.limit, 3)
  assert.equal(requests[0].params.sortDirection, 'asc')

  const reverseRequests = []
  const reversedOlderPage = await loadCodexTurnCursorWindow(
    async (method, params) => {
      reverseRequests.push({ method, params })
      return {
        data: [turn('four'), turn('three')],
        nextCursor: 'older-boundary',
        backwardsCursor: 'newer-with-anchor'
      }
    },
    'thread',
    { cursor: newerPage.olderCursor, direction: 'older', limit: 2 }
  )

  assert.deepEqual(
    reversedOlderPage.turns.map(({ id }) => id),
    ['three', 'four']
  )
  assert.equal(reverseRequests[0].params.limit, 2)
})

test('does not discard a valid row when a reverse-cursor anchor disappeared', async () => {
  const olderPage = await loadCodexTurnCursorWindow(
    async () => ({
      data: [turn('four'), turn('three')],
      nextCursor: 'older-boundary',
      backwardsCursor: 'newer-with-anchor'
    }),
    'thread',
    {
      cursor: 'sele:codex-turn-cursor:{"cursor":"page","anchorTurnId":null}',
      direction: 'older',
      limit: 2
    }
  )

  const page = await loadCodexTurnCursorWindow(
    async () => ({
      data: [turn('five'), turn('six'), turn('seven')],
      nextCursor: null,
      backwardsCursor: 'older-boundary'
    }),
    'thread',
    { cursor: olderPage.newerCursor, direction: 'newer', limit: 2 }
  )

  assert.deepEqual(
    page.turns.map(({ id }) => id),
    ['five', 'six']
  )
})

test('retains only the bounded raw turn tail for a long live chat', () => {
  const retained = retainCodexTurnTail(
    Array.from({ length: 500 }, (_, index) => turn(String(index + 1))),
    10
  )

  assert.equal(retained.droppedRenderableTurnCount, 490)
  assert.deepEqual(
    retained.turns.map(({ id }) => id),
    ['491', '492', '493', '494', '495', '496', '497', '498', '499', '500']
  )
})
