import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCodexTurnCursorWindow, retainCodexTurnTail } from './CodexPaginatedHistory.ts'

// Test fixtures intentionally omit production-only Codex fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const turn = (id) => ({ id, status: 'completed', items: [] })

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
