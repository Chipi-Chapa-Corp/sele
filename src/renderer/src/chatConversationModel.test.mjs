import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  buildChatConversationModel,
  getConversationTailWorkingStep,
  markChatItemsChanged
} from './chatConversationModel.ts'
import { assertUniqueProviderChatItemIds } from '../../shared/chatTurns.ts'

// Test fixtures intentionally omit optional presentation fields.
const message = (id, role, content) => ({ type: 'message', id, role, content })

test('unrendered streaming updates release old snapshots and rebuild after collection', () => {
  // A separate process gives this regression real GC without requiring --expose-gc
  // for the whole renderer-state suite. Keep the newest array alive throughout.
  const moduleUrl = new URL('./chatConversationModel.ts', import.meta.url).href
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--experimental-strip-types',
      '--expose-gc',
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict'
        import { markChatItemsChanged, buildChatConversationModel } from ${JSON.stringify(moduleUrl)}
        const refs = []
        let latest
        function stream() {
          let previous = [{ type: 'message', role: 'assistant', id: 'answer', content: 'initial' }]
          buildChatConversationModel(previous)
          for (let n = 0; n < 2000; n++) {
            refs.push(new WeakRef(previous))
            const next = [{ ...previous[0], content: 'revision ' + n }]
            markChatItemsChanged(next, 0, previous)
            previous = next
          }
          latest = previous
        }
        stream()
        // WeakRef targets survive the current JS job. Yield before each full GC.
        for (let n = 0; n < 8; n++) {
          await new Promise(resolve => setImmediate(resolve))
          global.gc()
        }
        assert.equal(refs.filter(ref => ref.deref()).length, 0, 'obsolete revisions retained')
        const model = buildChatConversationModel(latest)
        assert.equal(model.turns[0].items[0].content, 'revision 1999')
        assert.deepEqual(model, buildChatConversationModel([...latest]))
      `
    ],
    { encoding: 'utf8', timeout: 15_000 }
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

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

test('keeps stopped and failed turn messages available for retry', () => {
  const stoppedMessage = message('user-stopped', 'user', 'Stopped request')
  const failedMessage = message('user-failed', 'user', 'Failed request')
  const stoppedStep = {
    type: 'working',
    id: 'working-stopped',
    status: 'stopped',
    items: []
  }
  const failedStep = {
    type: 'working',
    id: 'working-failed',
    status: 'failed',
    items: []
  }
  const model = buildChatConversationModel([stoppedMessage, stoppedStep, failedMessage, failedStep])

  assert.equal(model.stoppedTurnRetryMessages.get(stoppedStep.id), stoppedMessage)
  assert.equal(model.stoppedTurnRetryMessages.get(failedStep.id), failedMessage)
})

test('incremental goal continuations start turns without inheriting the previous retry prompt', () => {
  const initialItems = [message('user', 'user', 'Start a goal')]
  const initialModel = buildChatConversationModel(initialItems)
  const goalStep = {
    type: 'working',
    id: 'goal:working',
    status: 'stopped',
    items: [],
    startsTurn: true
  }
  const nextItems = [...initialItems, goalStep]
  markChatItemsChanged(nextItems, initialItems.length, initialItems)
  const incremental = buildChatConversationModel(nextItems, initialModel)
  const full = buildChatConversationModel([...nextItems])
  assert.deepEqual(incremental, full)
  assert.deepEqual(
    incremental.turns.map((turn) => turn.id),
    ['user', 'goal:working']
  )
  assert.equal(incremental.stoppedTurnRetryMessages.has(goalStep.id), false)
})

test('active confirmation keeps a placeholder until the provider working step arrives', () => {
  const user = { ...message('confirmed', 'user', 'Question'), createdAt: 1234 }
  const fallback = getConversationTailWorkingStep([user], true)
  assert.equal(fallback.status, 'working')
  assert.equal(fallback.startedAt, 1234)
  assert.deepEqual(fallback.items, [])
  assert.equal(getConversationTailWorkingStep([user]), null, 'idle history has no placeholder')
  const pending = { type: 'pendingMessage', id: 'queued', kind: 'queued', content: 'Next' }
  assert.deepEqual(getConversationTailWorkingStep([user, pending], true), fallback)
  const working = { type: 'working', id: 'working', status: 'working', items: [] }
  assert.equal(getConversationTailWorkingStep([user, working, pending], true), working)
  assert.equal(
    getConversationTailWorkingStep(
      [user, working, message('streaming', 'assistant', 'Partial')],
      true
    ),
    working
  )
  for (const finished of [
    message('answer', 'assistant', 'Done'),
    { ...working, status: 'worked' },
    { ...working, status: 'stopped' },
    { ...working, status: 'failed' }
  ]) {
    assert.equal(
      getConversationTailWorkingStep([user, finished, pending], true),
      null,
      'finished turns must not acquire a synthetic working placeholder'
    )
  }
})

test('incremental steering targets track final work and preserve previous snapshots', () => {
  const earlier = { type: 'working', id: 'earlier', status: 'worked', items: [] }
  const final = { type: 'working', id: 'final', status: 'working', items: [] }
  const items = [
    message('initial', 'user', 'Start'),
    earlier,
    { ...message('steer', 'user', 'Change direction'), kind: 'steering' },
    final
  ]
  const initialModel = buildChatConversationModel(items)
  const completedItems = [...items.slice(0, -1), { ...final, status: 'worked' }]
  markChatItemsChanged(completedItems, items.length - 1, items)
  const completedModel = buildChatConversationModel(completedItems, initialModel)
  assert.deepEqual(completedModel, buildChatConversationModel([...completedItems]))
  assert.deepEqual(initialModel.steeredWorkingStepDisclosureTargets.get('earlier'), {
    status: 'working',
    progressPolicy: 'regular',
    hasNextWorkingStep: false
  })
  assert.deepEqual(completedModel.steeredWorkingStepDisclosureTargets.get('earlier'), {
    status: 'worked',
    progressPolicy: 'regular',
    hasNextWorkingStep: false
  })

  const nextItems = [
    ...completedItems,
    message('next-user', 'user', 'Next ordinary turn'),
    { type: 'working', id: 'next-working', status: 'working', items: [] }
  ]
  markChatItemsChanged(nextItems, completedItems.length, completedItems)
  const nextModel = buildChatConversationModel(nextItems, completedModel)
  assert.deepEqual(nextModel, buildChatConversationModel([...nextItems]))
  assert.deepEqual(nextModel.steeredWorkingStepDisclosureTargets.get('earlier'), {
    status: 'worked',
    progressPolicy: 'regular',
    hasNextWorkingStep: true
  })
  assert.equal(
    completedModel.steeredWorkingStepDisclosureTargets.get('earlier').hasNextWorkingStep,
    false
  )
})
