import assert from 'node:assert/strict'
import test from 'node:test'
import {
  rendererHistoricalWorkingItemLazyThreshold,
  unloadHistoricalWorkingSteps
} from './workingStepLazy.ts'

// Test fixtures intentionally omit production-only provider fields.
/* eslint-disable @typescript-eslint/explicit-function-return-type */
const createWorkingItems = (count) =>
  Array.from({ length: count }, (_, index) => ({
    type: 'message',
    id: `item-${index}`,
    content: `Activity ${index}`
  }))

const createWorkingStep = (id, count) => ({
  type: 'working',
  id,
  status: 'worked',
  items: createWorkingItems(count)
})

const prepareHistoricalStep = (count) => {
  const historicalStep = createWorkingStep('historical', count)
  const latestStep = createWorkingStep('latest', 0)
  return unloadHistoricalWorkingSteps({
    id: 'chat',
    items: [historicalStep, latestStep]
  }).items[0]
}

test('keeps historical working steps loaded through the lazy-loading threshold', () => {
  const step = prepareHistoricalStep(rendererHistoricalWorkingItemLazyThreshold)

  assert.equal(step.itemsLoaded, true)
  assert.equal(step.items.length, rendererHistoricalWorkingItemLazyThreshold)
})

test('unloads historical working steps above the lazy-loading threshold', () => {
  const itemCount = rendererHistoricalWorkingItemLazyThreshold + 1
  const step = prepareHistoricalStep(itemCount)

  assert.equal(step.itemsLoaded, false)
  assert.equal(step.items.length, 0)
  assert.equal(step.itemCount, itemCount)
})
