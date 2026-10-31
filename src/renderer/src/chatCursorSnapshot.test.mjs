import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { buildSync } from 'esbuild'

// Bundle the production snapshot resolver, including its payload/identity logic.
const { outputFiles } = buildSync({
  stdin: {
    contents:
      "export {getChatDetailFromSnapshot} from './src/renderer/src/workspace/chatControllerUtils'",
    resolveDir: new URL('../../../', import.meta.url).pathname,
    loader: 'tsx'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
})
const module = { exports: {} }
new Function('require', 'module', 'exports', outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports
)
const { getChatDetailFromSnapshot } = module.exports
const user = (id, content = id) => ({ id, type: 'message', role: 'user', content })
const detail = (ids, olderCursor = 'older', newerCursor = null) => ({
  id: 'chat',
  revision: 1,
  container: null,
  items: ids.map((id) => user(id)),
  itemsStartTurnIndex: 0,
  turnCount: ids.length,
  turnPagination: { kind: 'cursor', olderCursor, newerCursor }
})

for (const paused of [false, true]) {
  test(`a live cursor snapshot retains loaded history and appends new turns (paused=${paused})`, () => {
    const current = detail(['a', 'b', 'c', 'd'], 'before-a')
    const snapshot = detail(['c', 'd', 'e'], 'before-c')
    snapshot.items[0].content = 'Updated c'
    const next = getChatDetailFromSnapshot(snapshot, current, { preserveCurrentTurnWindow: paused })
    assert.deepEqual(
      next.items.map((item) => item.id),
      ['a', 'b', 'c', 'd', 'e']
    )
    assert.equal(next.items[0], current.items[0])
    assert.equal(next.items[2].content, 'Updated c')
    assert.equal(next.turnCount, 5)
    assert.deepEqual(next.turnPagination, current.turnPagination)
  })
}

test('cursor snapshots retain the prefix but remove the reverted suffix of an edited branch', () => {
  const current = detail(['a', 'b', 'c', 'd'], 'before-a')
  const snapshot = detail(['b', 'replacement'], 'before-b')
  const next = getChatDetailFromSnapshot(snapshot, current)
  assert.deepEqual(
    next.items.map((item) => item.id),
    ['a', 'b', 'replacement']
  )
  assert.equal(next.turnCount, 3)
})

test('a full-history replacement and a disjoint branch remain authoritative', () => {
  const current = detail(['a', 'b', 'c'], 'before-a')
  for (const snapshot of [
    detail(['b', 'replacement'], null),
    detail(['replacement'], 'before-new')
  ]) {
    assert.deepEqual(getChatDetailFromSnapshot(snapshot, current).items, snapshot.items)
  }
})

test('live snapshots refresh historical cursor pages without jumping to the live tail', () => {
  const current = detail(['a', 'b', 'c'], 'before-a', 'after-c')
  const snapshot = detail(['c', 'd'], 'before-c')
  snapshot.items[0].content = 'Updated c'
  const next = getChatDetailFromSnapshot(snapshot, current, { preserveCurrentTurnWindow: true })
  assert.deepEqual(
    next.items.map((item) => item.id),
    ['a', 'b', 'c']
  )
  assert.equal(next.items[2].content, 'Updated c')
  assert.deepEqual(next.turnPagination, current.turnPagination)
})
