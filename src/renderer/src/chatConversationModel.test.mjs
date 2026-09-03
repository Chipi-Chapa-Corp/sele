import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatConversationModel, markChatItemsChanged } from './chatConversationModel.ts'
import { assertUniqueProviderChatItemIds } from '../../shared/chatTurns.ts'

// Test fixtures intentionally omit optional presentation fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const message = (id, role, content) => ({ type: 'message', id, role, content })

test('incremental conversation builds do not mutate the previously rendered model', () => {
  const initialItems = [
    message('user-1', 'user', 'Question'),
    message('answer-1', 'assistant', 'A')
  ]
  const initialModel = buildChatConversationModel(initialItems)
  const initialTurnItems = [...initialModel.turns[0].items]
  const initialItemIds = new Set(initialModel.itemIds)
  const initialItemIndexes = new Map(initialModel.itemIndexesById)

  const nextItems = [
    ...initialItems,
    message('user-2', 'user', 'Follow-up'),
    message('answer-2', 'assistant', 'B')
  ]
  markChatItemsChanged(nextItems, initialItems.length, initialItems)
  const nextModel = buildChatConversationModel(nextItems, initialModel)

  assert.deepEqual(initialModel.turns[0].items, initialTurnItems)
  assert.equal(initialModel.turns.length, 1)
  assert.deepEqual(initialModel.itemIds, initialItemIds)
  assert.deepEqual(initialModel.itemIndexesById, initialItemIndexes)
  assert.equal(initialModel.itemIds.has('user-2'), false)
  assert.equal(nextModel.turns.length, 2)
  assert.equal(nextModel.itemIds.has('user-2'), true)
})

test('rejects duplicate transcript IDs at the renderer boundary', () => {
  assert.throws(
    () =>
      assertUniqueProviderChatItemIds([
        message('same-id', 'user', 'First'),
        message('same-id', 'assistant', 'Duplicate')
      ]),
    /duplicate item ID same-id/
  )
})
