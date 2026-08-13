import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getChatDetailItemsStartTurnIndex,
  getChatDetailTurnCount,
  mergeChatDetailTurnPage,
  retainLoadedChatDetailTurnWindow
} from './chatDetailWindow.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const turnItems = (startIndex, count) =>
  Array.from({ length: count }, (_, offset) => ({
    type: 'message',
    id: `user-${startIndex + offset}`,
    role: 'user',
    content: `Question ${startIndex + offset}`
  }))

test('merges an older page without retaining turns outside the bounded window', () => {
  const detail = {
    id: 'chat',
    items: turnItems(20, 10),
    itemsStartTurnIndex: 20,
    turnCount: 40
  }
  const result = mergeChatDetailTurnPage(
    detail,
    { items: turnItems(10, 10), startIndex: 10, totalCount: 40 },
    { startIndex: 10, endIndex: 30, totalCount: 40 }
  )

  assert.equal(getChatDetailItemsStartTurnIndex(result), 10)
  assert.equal(getChatDetailTurnCount(result), 40)
  assert.equal(result.items.length, 20)
  assert.equal(result.items[0].id, 'user-10')
  assert.equal(result.items.at(-1).id, 'user-29')
})

test('slides the sparse data window toward newer turns', () => {
  const detail = {
    id: 'chat',
    items: turnItems(10, 20),
    itemsStartTurnIndex: 10,
    turnCount: 40
  }
  const result = mergeChatDetailTurnPage(
    detail,
    { items: turnItems(30, 10), startIndex: 30, totalCount: 40 },
    { startIndex: 20, endIndex: 40, totalCount: 40 }
  )

  assert.equal(result.itemsStartTurnIndex, 20)
  assert.equal(result.items.length, 20)
  assert.equal(result.items[0].id, 'user-20')
  assert.equal(result.items.at(-1).id, 'user-39')
})

test('evicts materialized turns outside a retained viewport', () => {
  const detail = {
    id: 'chat',
    items: turnItems(10, 20),
    itemsStartTurnIndex: 10,
    turnCount: 40
  }
  const result = retainLoadedChatDetailTurnWindow(detail, {
    startIndex: 15,
    endIndex: 25,
    totalCount: 40
  })

  assert.equal(result.itemsStartTurnIndex, 15)
  assert.deepEqual(
    result.items.map((item) => item.id),
    Array.from({ length: 10 }, (_, index) => `user-${15 + index}`)
  )
})
