import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getLoadedChatTurnWindow,
  retainLoadedChatDetailTurnWindow,
  mergeChatDetailTurnPage,
  preserveOptimisticChatDetail,
  refreshRetainedChatDetailTurnWindow,
  shouldPreserveOptimisticTurnUntilUserMessage
} from './chatDetailWindow.ts'
import { shiftChatTurnWindow } from './chatTurnWindow.ts'

const user = (id) => ({ type: 'message', id, role: 'user', content: id })
const detail = (items, extra = {}) => ({
  id: 'claude-session',
  revision: 1,
  status: 'active',
  items,
  itemsStartTurnIndex: 0,
  turnCount: 1,
  ...extra
})

test('preserves optimistic turns for every provider until its user message arrives', () => {
  for (const providerId of ['codex', 'claude', 'copilot', 'opencode']) {
    assert.equal(shouldPreserveOptimisticTurnUntilUserMessage(providerId), true)
  }

  const optimistic = detail([
    user('previous'),
    user('optimistic:submitted:user'),
    { type: 'working', id: 'optimistic:submitted:working', status: 'working', items: [] }
  ])
  const preparing = detail(
    [
      user('previous'),
      {
        type: 'pendingMessage',
        id: 'submitted',
        kind: 'queued',
        content: 'submitted'
      }
    ],
    { revision: 2 }
  )

  const preserved = preserveOptimisticChatDetail(optimistic, preparing)
  assert.deepEqual(preserved.items, optimistic.items)
  assert.equal(preserved.revision, 2)

  const accepted = detail([user('previous'), user('submitted')], { revision: 3 })
  assert.equal(preserveOptimisticChatDetail(preserved, accepted), accepted)
})

test('a paused viewport replaces the placeholder with live activity and the completed answer', () => {
  const prompt = user('prompt')
  const placeholder = { type: 'working', id: 'working', status: 'working', items: [] }
  const current = detail([prompt, placeholder])
  const tool = { type: 'tool', id: 'read', status: 'completed' }
  const streaming = detail([prompt, { ...placeholder, items: [tool] }], { revision: 2 })
  const live = refreshRetainedChatDetailTurnWindow(current, streaming)
  assert.deepEqual(live.items, streaming.items)

  const completed = detail(
    [
      prompt,
      { ...placeholder, status: 'worked', items: [tool] },
      { type: 'message', id: 'answer', role: 'assistant', content: 'Finished' }
    ],
    { revision: 3, status: null }
  )
  const result = refreshRetainedChatDetailTurnWindow(live, completed)
  assert.deepEqual(result.items, completed.items)
  assert.equal(result.status, null)
  assert.equal(result.revision, 3)
})

test('refreshes overlapping turns while keeping older loaded turns and excluding newer turns', () => {
  const older = user('older')
  const prompt = user('prompt')
  const current = detail([older, prompt], { itemsStartTurnIndex: 4, turnCount: 6 })
  const answer = { type: 'message', id: 'answer', role: 'assistant', content: 'Finished' }
  const snapshot = detail([prompt, answer, user('new-turn')], {
    itemsStartTurnIndex: 5,
    turnCount: 7
  })
  const result = refreshRetainedChatDetailTurnWindow(current, snapshot)
  assert.deepEqual(result.items, [older, prompt, answer])
  assert.equal(result.itemsStartTurnIndex, 4)
  assert.equal(result.turnCount, 7)
})

test('keeps a disjoint history window when the latest snapshot arrives', () => {
  const current = detail([user('old')], { turnCount: 20 })
  const snapshot = detail([user('latest')], { itemsStartTurnIndex: 19, turnCount: 20 })
  const result = refreshRetainedChatDetailTurnWindow(current, snapshot)
  assert.deepEqual(result.items, current.items)
  assert.equal(result.itemsStartTurnIndex, 0)
})

test('an empty viewport accepts the first turn even when auto-scroll is paused', () => {
  const current = detail([], { turnCount: 0 })
  const snapshot = detail([user('prompt')])
  assert.equal(refreshRetainedChatDetailTurnWindow(current, snapshot), snapshot)
})

test('a partial retained page can page backward to the real first turn', () => {
  const allItems = Array.from({ length: 15 }, (_, index) => user(`turn-${index}`))
  const requestedWindow = { chatKey: 'session', startIndex: 0, endIndex: 15, totalCount: 15 }
  const partial = detail(allItems.slice(5), { itemsStartTurnIndex: 5, turnCount: 15 })
  const retained = mergeChatDetailTurnPage(
    partial,
    { items: [], startIndex: 0, totalCount: 15 },
    requestedWindow
  )
  const actualWindow = getLoadedChatTurnWindow(retained, requestedWindow)
  assert.equal(actualWindow.startIndex, 5)

  const startIndex = Math.max(0, actualWindow.startIndex - 10)
  const page = {
    items: allItems.slice(startIndex, actualWindow.startIndex),
    startIndex,
    totalCount: 15
  }
  const nextWindow = shiftChatTurnWindow(actualWindow, 'older', startIndex, 5, 15, 20)
  const recovered = mergeChatDetailTurnPage(retained, page, nextWindow)
  assert.deepEqual(recovered.items, allItems)
  assert.equal(getLoadedChatTurnWindow(recovered, nextWindow).startIndex, 0)
})

test('paging boundaries also expose unloaded newer turns', () => {
  const partial = detail([user('five'), user('six')], { itemsStartTurnIndex: 5, turnCount: 15 })
  assert.deepEqual(
    getLoadedChatTurnWindow(partial, {
      chatKey: 'session',
      startIndex: 0,
      endIndex: 15,
      totalCount: 15
    }),
    { chatKey: 'session', startIndex: 5, endIndex: 7, totalCount: 15 }
  )
})

test('keeps a narrower viewport within loaded history and recovers a disjoint viewport', () => {
  const loaded = detail(
    Array.from({ length: 10 }, (_, i) => user(String(i))),
    {
      itemsStartTurnIndex: 10,
      turnCount: 30
    }
  )
  const window = { chatKey: 'session', startIndex: 12, endIndex: 17, totalCount: 30 }
  assert.deepEqual(getLoadedChatTurnWindow(loaded, window), window)
  assert.deepEqual(getLoadedChatTurnWindow(loaded, { ...window, startIndex: 0, endIndex: 5 }), {
    ...window,
    startIndex: 10,
    endIndex: 20
  })
})

test('cursor pages retain their local coordinates and cursor metadata', () => {
  const loaded = detail([user('page')], {
    turnPagination: { kind: 'cursor', olderCursor: 'older', newerCursor: null }
  })
  const window = { chatKey: 'session', startIndex: 0, endIndex: 1, totalCount: 1 }
  assert.deepEqual(getLoadedChatTurnWindow(loaded, window), window)
  assert.equal(loaded.turnPagination.olderCursor, 'older')
})

test('retention keeps a cursor page and its exact navigation boundaries intact', () => {
  const current = detail(
    Array.from({ length: 11 }, (_, index) => user(`turn-${index}`)),
    {
      turnCount: 11,
      turnPagination: { kind: 'cursor', olderCursor: 'older', newerCursor: 'newer' }
    }
  )
  const requested = { chatKey: 'codex:chat', startIndex: 1, endIndex: 11, totalCount: 11 }
  assert.equal(retainLoadedChatDetailTurnWindow(current, requested), current)
  assert.deepEqual(getLoadedChatTurnWindow(current, requested), { ...requested, startIndex: 0 })
})

test('cursor navigation keeps two adjacent pages and their boundaries after payload refreshes', async () => {
  const { extendChatCursorWindow } = await import('./chatCursorWindow.ts')
  const page = (start) => ({
    items: Array.from({ length: 10 }, (_, index) => user(`turn-${start + index}`)),
    startIndex: 0,
    totalCount: 10,
    turnPagination: {
      kind: 'cursor',
      olderCursor: `before-${start}`,
      newerCursor: `after-${start + 9}`
    }
  })
  const latest = page(30)
  let current = detail(latest.items, { turnCount: 10, turnPagination: latest.turnPagination })
  let buffer = extendChatCursorWindow(null, 'codex:chat', current, page(20), 'older')
  assert.deepEqual(
    buffer.items.map((item) => item.id),
    Array.from({ length: 20 }, (_, i) => `turn-${20 + i}`)
  )
  current = { ...current, items: buffer.items.map((item) => ({ ...item, content: 'refreshed' })) }
  buffer = extendChatCursorWindow(buffer, 'codex:chat', current, page(10), 'older')
  assert.equal(buffer.items.length, 20)
  assert.equal(buffer.items[10].content, 'refreshed')
  assert.equal(buffer.pages[0].turnPagination.olderCursor, 'before-10')
  assert.equal(buffer.pages[1].turnPagination.newerCursor, 'after-29')
  current = { ...current, items: buffer.items }
  buffer = extendChatCursorWindow(buffer, 'codex:chat', current, page(30), 'newer')
  assert.deepEqual(
    buffer.items.map((item) => item.id),
    Array.from({ length: 20 }, (_, i) => `turn-${20 + i}`)
  )
})
