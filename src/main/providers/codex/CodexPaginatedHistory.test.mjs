import assert from 'node:assert/strict'
import test from 'node:test'
import { hydrateCodexTurnRange, loadCodexTurnCatalog } from './CodexPaginatedHistory.ts'

// Test fixtures intentionally omit production-only Codex fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const turn = (id, items = [{ type: 'agentMessage', id: `${id}:answer`, text: id }]) => ({
  id,
  status: 'completed',
  items
})

test('enumerates turn metadata without requesting transcript items', async () => {
  const requests = []
  const catalog = await loadCodexTurnCatalog(async (method, params) => {
    requests.push({ method, params })
    if (params.cursor == null) return { data: [turn('one')], nextCursor: 'next' }
    return { data: [turn('two')], nextCursor: null }
  }, 'thread')

  assert.deepEqual(
    catalog.map((entry) => ({ id: entry.id, items: entry.items })),
    [
      { id: 'one', items: [] },
      { id: 'two', items: [] }
    ]
  )
  assert.deepEqual(
    requests.map(({ method, params }) => ({
      method,
      cursor: params.cursor,
      itemsView: params.itemsView
    })),
    [
      { method: 'thread/turns/list', cursor: null, itemsView: 'notLoaded' },
      { method: 'thread/turns/list', cursor: 'next', itemsView: 'notLoaded' }
    ]
  )
})

test('hydrates items only for turns in the requested range', async () => {
  const requests = []
  const catalog = [turn('zero', []), turn('one', []), turn('two', []), turn('three', [])]
  const hydrated = await hydrateCodexTurnRange(
    async (method, params) => {
      assert.equal(method, 'thread/turns/list')
      requests.push(params)
      if (params.itemsView === 'notLoaded') {
        return { data: [turn('three', [])], nextCursor: 'older' }
      }
      return { data: [turn('two'), turn('one')], nextCursor: 'oldest' }
    },
    'thread',
    catalog,
    1,
    3
  )

  assert.deepEqual(
    requests.map(({ cursor, limit, sortDirection, itemsView }) => ({
      cursor,
      limit,
      sortDirection,
      itemsView
    })),
    [
      { cursor: null, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' },
      { cursor: 'older', limit: 2, sortDirection: 'desc', itemsView: 'full' }
    ]
  )
  assert.deepEqual(
    hydrated.map((entry) => [entry.id, entry.items[0].id]),
    [
      ['one', 'one:answer'],
      ['two', 'two:answer']
    ]
  )
})
