import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeCodexSnapshotsById,
  projectCodexAgentResponseOverlay,
  projectCodexTurnTail
} from './CodexLiveMerge.ts'

// Test fixtures intentionally omit production-only Codex fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const turn = (id, startedAt, text = id) => ({
  id,
  startedAt,
  status: 'completed',
  items: [{ id: `${id}:message`, type: 'agentMessage', text }]
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const mergeTurn = (previous, next) => ({
  ...previous,
  ...next,
  items: mergeCodexSnapshotsById([...previous.items, ...next.items], (first, second) => ({
    ...first,
    ...second
  }))
})

test('uses the backend page as the only persisted turn order', () => {
  const current = [turn('0002', 2), turn('0003', 3)]
  const authoritative = [turn('0002', 2), turn('0003', 3), turn('0004', 4)]

  const projected = projectCodexTurnTail(authoritative, current, 10, new Set(), mergeTurn)

  assert.deepEqual(
    projected.map(({ id }) => id),
    ['0002', '0003', '0004']
  )
})

test('rejects a disjoint page instead of guessing its chronology', () => {
  const current = [turn('0011', 11), turn('0012', 12)]
  const disjointPage = [turn('0001', 1), turn('0002', 2)]

  assert.throws(
    () => projectCodexTurnTail(disjointPage, current, 10, new Set(), mergeTurn),
    /consistent boundary/
  )
})

test('rejects duplicate turns in an authoritative page', () => {
  assert.throws(
    () => projectCodexTurnTail([turn('0001', 1), turn('0001', 1)], [], 10, new Set(), mergeTurn),
    /duplicate ID 0001/
  )
})

test('rejects reordered backend turns', () => {
  assert.throws(
    () =>
      projectCodexTurnTail(
        [turn('0002', 2), turn('0001', 1)],
        [turn('0001', 1), turn('0002', 2)],
        10,
        new Set(),
        mergeTurn
      ),
    /changed order/
  )
})

test('appends only explicit local or active overlays after backend turns', () => {
  const liveTurn = turn('0003', 3, 'live')
  const localTurn = { ...turn('local', 4), local: true }
  const projected = projectCodexTurnTail(
    [turn('0001', 1), turn('0002', 2)],
    [turn('0001', 1), turn('0002', 2), liveTurn, localTurn],
    10,
    new Set(['0003']),
    mergeTurn
  )

  assert.deepEqual(
    projected.map(({ id }) => id),
    ['0001', '0002', '0003', 'local']
  )
})

test('rejects a regressed backend suffix', () => {
  assert.throws(
    () =>
      projectCodexTurnTail(
        [turn('0001', 1), turn('0002', 2)],
        [turn('0001', 1), turn('0002', 2), turn('0003', 3)],
        10,
        new Set(),
        mergeTurn
      ),
    /history is unavailable/
  )
})

test('projects a raw response without inserting it into stored turn items', () => {
  const stored = turn('turn', 1)
  stored.items = []
  const projected = projectCodexAgentResponseOverlay(stored, { text: 'Complete response' })

  assert.equal(stored.items.length, 0)
  assert.equal(projected.items.length, 1)
  assert.equal(projected.items[0].id, 'turn:assistant-overlay')
  assert.equal(projected.items[0].text, 'Complete response')
})

test('does not project a raw overlay once an authoritative agent item exists', () => {
  const stored = turn('turn', 1, 'Authoritative response')
  const projected = projectCodexAgentResponseOverlay(stored, {
    text: 'unrelated protocol fallback'
  })

  assert.equal(projected, stored)
  assert.equal(projected.items.length, 1)
  assert.equal(projected.items[0].text, 'Authoritative response')
})
