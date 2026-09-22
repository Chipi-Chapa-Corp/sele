import assert from 'node:assert/strict'
import test from 'node:test'
import {
  limitWorkingItemPayload,
  prepareWorkingStepPage,
  rendererHistoricalWorkingItemLazyThreshold,
  rendererWorkingItemPayloadPreviewCharacters,
  unloadHistoricalWorkingSteps
} from './workingStepLazy.ts'

// Test fixtures intentionally omit production-only provider fields.
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

// Claude `Read` on an image yields a path-less inline data URL that is often several times the
// per-item preview budget. A sliced data URL cannot decode, so images bypass the budget entirely.
const createImageTool = (index, dataUrlLength) => ({
  type: 'tool',
  id: `read-${index}`,
  toolId: `read-${index}`,
  activity: 'read',
  status: 'finished',
  label: 'Read',
  command: null,
  stdout: null,
  cwd: null,
  diffs: [],
  images: [
    {
      dataUrl: `data:image/jpeg;base64,${'A'.repeat(dataUrlLength)}`,
      name: 'Generated image'
    }
  ],
  rawInput: { file_path: `/tmp/bench/${index}.png` },
  rawOutput: null
})

test('tool images are passed through whole and never counted against the payload budget', () => {
  const dataUrlLength = rendererWorkingItemPayloadPreviewCharacters * 3
  const tools = Array.from({ length: 10 }, (_, index) => createImageTool(index, dataUrlLength))
  const group = {
    type: 'toolGroup',
    id: 'reads',
    activity: 'read',
    status: 'finished',
    label: 'Read',
    tools
  }

  const limited = limitWorkingItemPayload(group)
  assert.equal(limited.tools.length, 10)
  limited.tools.forEach((tool, index) => {
    assert.equal(tool.images.length, 1)
    assert.equal(tool.images[0].dataUrl, tools[index].images[0].dataUrl)
    assert.equal(tool.payloadTruncated, false)
    assert.equal(tool.payloadLoaded, true)
  })

  const page = prepareWorkingStepPage(
    { type: 'working', id: 'step', status: 'worked', items: tools },
    0,
    50
  )
  const pageTools = page.items.flatMap((item) => (item.type === 'toolGroup' ? item.tools : [item]))
  assert.equal(pageTools.length, 10)
  pageTools.forEach((tool, index) => {
    assert.equal(tool.payloadLoaded, true)
    assert.equal(tool.images[0]?.dataUrl, tools[index].images[0].dataUrl)
  })
})
