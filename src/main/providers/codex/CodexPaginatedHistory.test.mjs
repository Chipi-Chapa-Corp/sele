import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CodexTurnWindowMismatchError,
  hydrateCodexTurnRange,
  loadCodexTurnCatalog,
  retryCodexTurnWindowWithFreshCatalog
} from './CodexPaginatedHistory.ts'

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

test('refreshes a stale catalog and retries the requested window once', async () => {
  const staleCatalog = [turn('zero', []), turn('one', []), turn('two', [])]
  const freshCatalog = [...staleCatalog, turn('three', [])]
  let refreshCount = 0
  let hydrationCount = 0
  // Test fixtures intentionally omit production-only Codex fields.
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const loadLatestTwo = async (catalog) => {
    hydrationCount += 1
    return hydrateCodexTurnRange(
      async (method, params) => {
        assert.equal(method, 'thread/turns/list')
        assert.equal(params.itemsView, 'full')
        return { data: [turn('three'), turn('two')], nextCursor: 'older' }
      },
      'thread',
      catalog,
      Math.max(0, catalog.length - 2),
      catalog.length
    )
  }

  const result = await retryCodexTurnWindowWithFreshCatalog(
    staleCatalog,
    async () => {
      refreshCount += 1
      return freshCatalog
    },
    loadLatestTwo
  )

  assert.equal(refreshCount, 1)
  assert.equal(hydrationCount, 2)
  assert.equal(result.turnCatalog, freshCatalog)
  assert.deepEqual(
    result.result.map((entry) => entry.id),
    ['two', 'three']
  )
})

test('surfaces a persistent turn mismatch after one catalog refresh', async () => {
  const catalog = [turn('zero', []), turn('one', [])]
  let refreshCount = 0
  let hydrationCount = 0

  await assert.rejects(
    retryCodexTurnWindowWithFreshCatalog(
      catalog,
      async () => {
        refreshCount += 1
        return catalog
      },
      async (currentCatalog) => {
        hydrationCount += 1
        return hydrateCodexTurnRange(
          async () => ({ data: [turn('one')], nextCursor: null }),
          'thread',
          currentCatalog,
          0,
          currentCatalog.length
        )
      }
    ),
    (error) => {
      assert.ok(error instanceof CodexTurnWindowMismatchError)
      assert.deepEqual(error.missingTurnIds, ['zero'])
      return true
    }
  )

  assert.equal(refreshCount, 1)
  assert.equal(hydrationCount, 2)
})
