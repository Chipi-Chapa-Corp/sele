import assert from 'node:assert/strict'
import test from 'node:test'
import { ImportedHistoryView } from './ImportedHistoryView.ts'
import { sliceProviderChatTurns, getProviderChatTurnCount } from '../../shared/chatTurns.ts'

const turn = (index, prefix = 'archive') => [
  { type: 'message', id: `${prefix}-u-${index}`, role: 'user', content: `Prompt ${index}` },
  {
    type: 'working',
    id: `${prefix}-w-${index}`,
    status: 'worked',
    items: [{ type: 'tool', id: 'tool', stdout: 'large tool result' }]
  },
  { type: 'message', id: `${prefix}-a-${index}`, role: 'assistant', content: `Answer ${index}` }
]
const setup = (count = 1000, nativeCount = 0, cursorNative = false) => {
  let reads = 0,
    toolsRead = 0,
    decorated = 0
  const archive = Array.from({ length: count }, (_, i) => turn(i)).flat()
  for (const item of archive.filter((item) => item.type === 'working'))
    Object.defineProperty(item, 'items', {
      get() {
        toolsRead++
        return [{ type: 'tool', id: 'tool', stdout: 'hidden'.repeat(100000) }]
      }
    })
  const synthetic = turn(0, 'synthetic')
  const native = [
    ...synthetic,
    ...Array.from({ length: nativeCount }, (_, i) => turn(i, 'native')).flat()
  ]
  const detail = {
    id: 'target',
    revision: 1,
    title: 'Imported',
    capabilities: { editMessages: false },
    items: native,
    subagents: []
  }
  const read = (start, limit) => {
    reads++
    assert.ok(limit <= 10, 'UI must not request a complete transcript')
    return {
      ...detail,
      items: sliceProviderChatTurns(native, start, start + limit),
      itemsStartTurnIndex: start,
      turnCount: 1 + nativeCount
    }
  }
  const adapter = {
    getChatWindow: async (_id, window) => {
      const start = window.startIndex ?? Math.max(0, 1 + nativeCount - window.limit)
      const result = read(start, window.limit)
      return cursorNative
        ? {
            ...result,
            turnCount: undefined,
            turnPagination: {
              kind: 'cursor',
              olderCursor: start > 0 ? String(start) : null,
              newerCursor: null
            }
          }
        : result
    }
  }
  if (cursorNative)
    adapter.getChatCursorWindow = async (_id, window) => {
      const end = Number(window.cursor)
      const start = Math.max(0, end - window.limit)
      return {
        ...read(start, Math.min(window.limit, end)),
        turnCount: undefined,
        turnPagination: {
          kind: 'cursor',
          olderCursor: start > 0 ? String(start) : null,
          newerCursor: null
        }
      }
    }
  const record = {
    chatId: 'target',
    providerId: 'claude',
    baseline: synthetic.map((item) => item.id),
    archive: { chat: { items: archive } }
  }
  const view = new ImportedHistoryView(
    record,
    adapter,
    (items) =>
      items.map((item) => {
        decorated++
        return { ...item, id: `archive:${item.id}` }
      }),
    (detail, items) => ({ ...detail, items })
  )
  return { view, archive, detail, stats: () => ({ reads, toolsRead, decorated }) }
}

test('large imported archives open with one bounded native read and only the visible archived turns', async () => {
  const h = setup(10000)
  const latest = await h.view.latest(10)
  assert.equal(getProviderChatTurnCount(latest.items), 10)
  assert.equal(latest.items[0].id, 'archive:archive-u-9990')
  assert.deepEqual(h.stats(), { reads: 1, toolsRead: 20, decorated: 30 })
  const older = await h.view.cursor({
    cursor: latest.turnPagination.olderCursor,
    direction: 'older',
    limit: 10
  })
  assert.equal(older.items[0].id, 'archive:archive-u-9980')
  const newer = await h.view.cursor({
    cursor: older.turnPagination.newerCursor,
    direction: 'newer',
    limit: 10
  })
  assert.deepEqual(
    newer.items.map((item) => item.id),
    latest.items.map((item) => item.id)
  )
  assert.equal(h.stats().reads, 1, 'archived navigation must not reread native history')
})

test('indexed and opaque native pagination cross into archived history without gaps or synthetic duplicates', async () => {
  for (const cursorNative of [false, true]) {
    const h = setup(23, 27, cursorNative)
    let page = await h.view.latest(10)
    const pages = [page]
    while (page.turnPagination.olderCursor) {
      page = await h.view.cursor({
        cursor: page.turnPagination.olderCursor,
        direction: 'older',
        limit: 10
      })
      pages.unshift(page)
    }
    const items = pages.flatMap((page) => page.items)
    assert.equal(getProviderChatTurnCount(items), 50)
    assert.equal(new Set(items.map((item) => item.id)).size, 150)
    assert.equal(
      items.some((item) => item.id.startsWith('synthetic')),
      false
    )
    assert.deepEqual(
      items
        .filter((item) => item.type === 'message' && item.role === 'user')
        .map((item) => item.content),
      [
        ...Array.from({ length: 23 }, (_, i) => `Prompt ${i}`),
        ...Array.from({ length: 27 }, (_, i) => `Prompt ${i}`)
      ]
    )
    assert.equal(h.stats().reads, 3)
  }
})

test('stream projections stay bounded and archived item expansion does not hydrate unrelated tools', async () => {
  const h = setup(10000)
  const projected = h.view.fromNative(h.detail)
  assert.equal(projected.items.length, 30)
  const before = h.stats().toolsRead
  const item = await h.view.item('archive:archive-w-37', 3)
  assert.ok(item.items.some((item) => item.id === 'archive:archive-w-37'))
  assert.equal(h.stats().toolsRead - before, 3)
})

test('late native send acknowledgements cannot replace a newer final response', async () => {
  const h = setup(3)
  const complete = {
    ...h.detail,
    revision: 3,
    items: [{ type: 'message', id: 'final', role: 'assistant', content: 'Complete' }]
  }
  const final = h.view.fromNative(complete)
  const stale = h.view.fromNative({ ...h.detail, revision: 2 })
  assert.equal(stale, final)
})

test('scrolling keeps current control metadata and cursors survive a long streamed response', async () => {
  const h = setup(40)
  const user = { type: 'message', id: 'new-user', role: 'user', content: 'Continue' }
  const initial = h.view.fromNative({
    ...h.detail,
    revision: 2,
    status: 'active',
    items: [...h.detail.items, user]
  })
  const cursor = initial.turnPagination.olderCursor
  for (let index = 0; index < 1000; index++)
    h.view.fromNative({
      ...h.detail,
      revision: index + 3,
      status: 'active',
      items: [
        ...h.detail.items,
        user,
        { type: 'message', id: 'answer', role: 'assistant', content: 'chunk ' + index }
      ]
    })
  const older = await h.view.cursor({ cursor, direction: 'older', limit: 10 })
  assert.equal(older.status, 'active')
  assert.equal(older.revision, 1002)
  const newer = await h.view.cursor({
    cursor: older.turnPagination.newerCursor,
    direction: 'newer',
    limit: 10
  })
  assert.equal(newer.items.at(-1).content, 'chunk 999')
})
