import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatConversationModel, markChatItemsChanged } from './chatConversationModel.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const message = (id, role) => ({ type: 'message', id, role, content: id })
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const working = (id, status = 'worked') => ({ type: 'working', id, status, items: [] })

test('builds turn and item indexes in one model', () => {
  const firstUser = message('turn-1:user', 'user')
  const firstWorking = working('turn-1:working')
  const firstAnswer = message('turn-1:answer', 'assistant')
  const secondUser = message('turn-2:user', 'user')
  const secondWorking = working('turn-2:working', 'stopped')
  const pending = { type: 'pendingMessage', id: 'pending', kind: 'queued', content: 'Next' }
  const items = [firstUser, firstWorking, firstAnswer, secondUser, secondWorking, pending]

  const model = buildChatConversationModel(items)

  assert.deepEqual(model.turns, [
    { id: firstUser.id, items: [firstUser, firstWorking, firstAnswer] },
    { id: secondUser.id, items: [secondUser, secondWorking] },
    { id: pending.id, items: [pending] }
  ])
  assert.equal(model.itemIndexesById.get(secondWorking.id), 4)
  assert.equal(model.firstPendingItemId, pending.id)
  assert.strictEqual(model.lastNonPendingItem, secondWorking)
  assert.strictEqual(model.stoppedTurnRetryMessages.get(secondWorking.id), secondUser)
})

test('indexes relationships between working steps without rescanning history', () => {
  const first = working('turn-1:working')
  const second = working('turn-2:working', 'stopped')
  const third = working('turn-3:working', 'working')

  const model = buildChatConversationModel([
    message('turn-1:user', 'user'),
    first,
    message('turn-2:user', 'user'),
    second,
    message('turn-3:user', 'user'),
    third
  ])

  assert.deepEqual(Array.from(model.workingStepIdsWithNextWorkingStep), [first.id, second.id])
  assert.deepEqual(model.followingWorkingStepsById.get(first.id), {
    hasNextWorkingStep: true,
    status: second.status
  })
  assert.deepEqual(model.followingWorkingStepsById.get(second.id), {
    hasNextWorkingStep: false,
    status: third.status
  })
  assert.equal(model.followingWorkingStepsById.has(third.id), false)
})

test('associates stopped working steps with the matching turn user message', () => {
  const firstUser = message('shared-prefix:first:user', 'user')
  const secondUser = message('shared-prefix:second:user', 'user')
  const stopped = working('shared-prefix:second:working', 'stopped')

  const model = buildChatConversationModel([firstUser, secondUser, stopped])

  assert.strictEqual(model.stoppedTurnRetryMessages.get(stopped.id), secondUser)
})

test('rebuilds only the changed turn suffix for provider deltas', () => {
  const firstUser = message('turn-1:user', 'user')
  const firstWorking = working('turn-1:working')
  const secondUser = message('turn-2:user', 'user')
  const secondWorking = working('turn-2:working')
  const thirdUser = message('turn-3:user', 'user')
  const thirdWorking = working('turn-3:working', 'working')
  const items = [firstUser, firstWorking, secondUser, secondWorking, thirdUser, thirdWorking]
  const firstModel = buildChatConversationModel(items)
  const firstTurn = firstModel.turns[0]
  const secondTurn = firstModel.turns[1]
  const thirdTurn = firstModel.turns[2]

  const updatedThirdWorking = { ...thirdWorking, status: 'stopped' }
  const updatedItems = [...items.slice(0, 5), updatedThirdWorking]
  markChatItemsChanged(updatedItems, 5, items)
  const updatedModel = buildChatConversationModel(updatedItems)

  assert.strictEqual(updatedModel.turns[0], firstTurn)
  assert.strictEqual(updatedModel.turns[1], secondTurn)
  assert.notStrictEqual(updatedModel.turns[2], thirdTurn)
  assert.strictEqual(updatedModel.turns[2].items[1], updatedThirdWorking)
  assert.deepEqual(updatedModel.followingWorkingStepsById.get(secondWorking.id), {
    hasNextWorkingStep: false,
    status: 'stopped'
  })
  assert.strictEqual(updatedModel.stoppedTurnRetryMessages.get(updatedThirdWorking.id), thirdUser)

  const rebuiltPreviousModel = buildChatConversationModel(items)
  assert.strictEqual(rebuiltPreviousModel.turns[2].items[1], thirdWorking)
})

test('appends a new turn without rebuilding completed turns', () => {
  const firstUser = message('turn-1:user', 'user')
  const firstWorking = working('turn-1:working')
  const items = [firstUser, firstWorking]
  const firstModel = buildChatConversationModel(items)
  const firstTurn = firstModel.turns[0]
  const pending = { type: 'pendingMessage', id: 'pending', kind: 'queued', content: 'Next' }
  const updatedItems = [...items, pending]

  markChatItemsChanged(updatedItems, items.length, items)
  const updatedModel = buildChatConversationModel(updatedItems)

  assert.strictEqual(updatedModel.turns[0], firstTurn)
  assert.deepEqual(updatedModel.turns[1], { id: pending.id, items: [pending] })
  assert.equal(updatedModel.firstPendingItemId, pending.id)
})

test('consumes provider change metadata after building its model', () => {
  const firstUser = message('turn-1:user', 'user')
  const firstWorking = working('turn-1:working')
  const secondUser = message('turn-2:user', 'user')
  const secondWorking = working('turn-2:working')
  const originalItems = [firstUser, firstWorking, secondUser, secondWorking]
  const updatedItems = [...originalItems.slice(0, 3), { ...secondWorking, status: 'stopped' }]

  // Build without a cached predecessor. The metadata must still be consumed rather than retaining
  // originalItems until updatedItems itself becomes unreachable.
  markChatItemsChanged(updatedItems, 3, originalItems)
  buildChatConversationModel(updatedItems)

  const originalModel = buildChatConversationModel(originalItems)
  const originalFirstTurn = originalModel.turns[0]
  const pending = { type: 'pendingMessage', id: 'pending', kind: 'queued', content: 'Next' }
  const appendedItems = [...updatedItems, pending]
  markChatItemsChanged(appendedItems, updatedItems.length, updatedItems)
  buildChatConversationModel(appendedItems)

  // Building appendedItems evicts updatedItems from the model cache. Rebuilding updatedItems must
  // now be a full build; stale metadata would incorrectly reuse and retain originalItems.
  const rebuiltModel = buildChatConversationModel(updatedItems)
  assert.notStrictEqual(rebuiltModel.turns[0], originalFirstTurn)
})
