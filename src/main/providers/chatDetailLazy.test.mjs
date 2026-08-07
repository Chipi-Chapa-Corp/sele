import assert from 'node:assert/strict'
import test from 'node:test'
import { unloadHistoricalWorkingSteps } from './workingStepLazy.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const workingStep = (id, itemCount) => ({
  type: 'working',
  id,
  status: 'worked',
  items: Array.from({ length: itemCount }, (_, index) => ({
    type: 'message',
    id: `${id}:item:${index}`,
    content: `Item ${index}`
  }))
})

test('unloads every working section except the latest one', () => {
  const first = workingStep('first', 2)
  const second = workingStep('second', 3)
  const latest = workingStep('latest', 4)
  const message = { type: 'message', id: 'message', role: 'user', content: 'Hello' }
  const detail = { id: 'chat', items: [first, message, second, latest] }

  const result = unloadHistoricalWorkingSteps(detail)

  assert.deepEqual(result.items[0], {
    ...first,
    items: [],
    itemsLoaded: false,
    itemCount: 2
  })
  assert.strictEqual(result.items[1], message)
  assert.deepEqual(result.items[2], {
    ...second,
    items: [],
    itemsLoaded: false,
    itemCount: 3
  })
  assert.strictEqual(result.items[3], latest)
  assert.equal(first.items.length, 2)
})

test('keeps the latest working section loaded even when a message follows it', () => {
  const latest = workingStep('latest', 2)
  const detail = {
    id: 'chat',
    items: [latest, { type: 'message', id: 'answer', role: 'assistant', content: 'Done' }]
  }

  assert.strictEqual(unloadHistoricalWorkingSteps(detail), detail)
})

test('preserves an existing unloaded item count', () => {
  const unloaded = {
    ...workingStep('first', 0),
    itemsLoaded: false,
    itemCount: 17
  }
  const latest = workingStep('latest', 1)
  const detail = { id: 'chat', items: [unloaded, latest] }

  const result = unloadHistoricalWorkingSteps(detail)

  assert.strictEqual(result, detail)
  assert.equal(result.items[0].itemCount, 17)
})
