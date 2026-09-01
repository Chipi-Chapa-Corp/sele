import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CodexTurnWindowMismatchError,
  planCodexHistoryEdit,
  selectCodexTurnRangeFromSnapshots
} from './CodexPaginatedHistory.ts'

// Fixtures intentionally include only the fields used by history planning.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const turn = (id, status = 'completed') => ({ id, status, items: [] })

test('retains all completed history when editing an unprojected newest turn', () => {
  const catalog = [turn('one'), turn('two'), turn('three')]
  const loadedTurns = [...catalog, turn('active', 'inProgress')]

  const plan = planCodexHistoryEdit(catalog, loadedTurns, 0, 'active')

  assert.deepEqual(
    plan.retainedCatalog.map((entry) => entry.id),
    ['one', 'two', 'three']
  )
  assert.deepEqual([...plan.rolledBackTurnIds], ['active'])
  assert.equal(plan.targetTurnIndex, 3)
})

test('uses global tail indexes for an unprojected newest turn in a long chat', () => {
  const catalog = Array.from({ length: 100 }, (_, index) => turn(`turn-${index}`))
  const loadedTurns = [...catalog.slice(91), turn('active', 'inProgress')]

  const plan = planCodexHistoryEdit(catalog, loadedTurns, 91, 'active')

  assert.equal(plan.retainedCatalog.length, 100)
  assert.deepEqual([...plan.rolledBackTurnIds], ['active'])
  assert.equal(plan.targetTurnIndex, 100)
})

test('retains turns before a projected edit target and rejects the remainder', () => {
  const catalog = [turn('one'), turn('two'), turn('three'), turn('four')]

  const plan = planCodexHistoryEdit(catalog, catalog.slice(1), 1, 'three')

  assert.deepEqual(
    plan.retainedCatalog.map((entry) => entry.id),
    ['one', 'two']
  )
  assert.deepEqual([...plan.rolledBackTurnIds], ['three', 'four'])
  assert.equal(plan.targetTurnIndex, 2)
})

test('refuses an empty or truncated catalog instead of erasing known history', () => {
  const loadedTurns = [turn('one'), turn('two'), turn('active', 'inProgress')]

  assert.throws(
    () => planCodexHistoryEdit([], loadedTurns, 0, 'active'),
    /history is still loading/
  )
})

test('reconstructs an omitted pagination window from exact catalogued snapshot IDs', () => {
  const catalog = [turn('zero'), turn('one'), turn('two'), turn('three')]
  const rolloutSnapshot = [turn('one'), turn('two')]
  const structuredSnapshot = [
    turn('zero'),
    { ...turn('two'), status: 'interrupted' },
    turn('three')
  ]

  const selected = selectCodexTurnRangeFromSnapshots(
    catalog,
    0,
    catalog.length,
    rolloutSnapshot,
    structuredSnapshot
  )

  assert.deepEqual(
    selected.map((entry) => entry.id),
    ['zero', 'one', 'two', 'three']
  )
  assert.equal(selected[2].status, 'interrupted')
})

test('still rejects a turn absent from every fallback snapshot', () => {
  const catalog = [turn('zero'), turn('missing')]

  assert.throws(
    () => selectCodexTurnRangeFromSnapshots(catalog, 0, catalog.length, [turn('zero')]),
    (error) => {
      assert.ok(error instanceof CodexTurnWindowMismatchError)
      assert.deepEqual(error.missingTurnIds, ['missing'])
      return true
    }
  )
})
