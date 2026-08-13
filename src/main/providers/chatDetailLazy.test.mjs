import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prepareChatDetailForRenderer,
  rendererChatPagePayloadBudgetCharacters,
  rendererMessageAttachmentLimit
} from './chatDetailLazy.ts'
import {
  getWorkingItemPayloadCharacterCount,
  limitWorkingItemPayload,
  prepareWorkingStepPage,
  rendererWorkingPagePayloadBudgetCharacters,
  unloadHistoricalWorkingSteps
} from './workingStepLazy.ts'

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
    itemCount: 2,
    itemsStartIndex: 0
  })
  assert.strictEqual(result.items[1], message)
  assert.deepEqual(result.items[2], {
    ...second,
    items: [],
    itemsLoaded: false,
    itemCount: 3,
    itemsStartIndex: 0
  })
  assert.deepEqual(result.items[3], {
    ...latest,
    itemsLoaded: true,
    itemCount: 4,
    itemsStartIndex: 0
  })
  assert.equal(first.items.length, 2)
})

test('keeps a bounded latest working section loaded even when a message follows it', () => {
  const latest = workingStep('latest', 2)
  const detail = {
    id: 'chat',
    items: [latest, { type: 'message', id: 'answer', role: 'assistant', content: 'Done' }]
  }

  const result = unloadHistoricalWorkingSteps(detail)
  assert.deepEqual(result.items[0], {
    ...latest,
    itemsLoaded: true,
    itemCount: 2,
    itemsStartIndex: 0
  })
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

  assert.notStrictEqual(result, detail)
  assert.equal(result.items[0].itemCount, 17)
  assert.equal(result.items[0].itemsStartIndex, 0)
})

test('keeps only the latest ten turns in renderer chat state', () => {
  const items = Array.from({ length: 25 }, (_, index) => [
    { type: 'message', id: `user-${index}`, role: 'user', content: `Question ${index}` },
    { type: 'message', id: `assistant-${index}`, role: 'assistant', content: `Answer ${index}` }
  ]).flat()

  const result = prepareChatDetailForRenderer({ id: 'chat', items })

  assert.equal(result.turnCount, 25)
  assert.equal(result.itemsStartTurnIndex, 15)
  assert.equal(result.items.length, 20)
  assert.equal(result.items[0].id, 'user-15')
  assert.equal(result.items.at(-1).id, 'assistant-24')
})

test('caps aggregate message payload across the retained turn page', () => {
  const items = Array.from({ length: 10 }, (_, index) => [
    { type: 'message', id: `user-${index}`, role: 'user', content: 'u'.repeat(600_000) },
    {
      type: 'message',
      id: `assistant-${index}`,
      role: 'assistant',
      content: 'a'.repeat(600_000)
    }
  ]).flat()

  const result = prepareChatDetailForRenderer({ id: 'chat', items })
  const retainedCharacters = result.items.reduce(
    (total, item) => total + ('content' in item ? item.content.length : 0),
    0
  )
  assert.ok(retainedCharacters < rendererChatPagePayloadBudgetCharacters + 1_000)
  assert.ok(result.items.every((item) => !('content' in item) || item.payloadTruncated === true))
})

test('caps attachment collections and removes inline image data from message previews', () => {
  const attachments = Array.from({ length: 100 }, (_, index) => ({
    kind: 'image',
    name: `image-${index}`,
    dataUrl: `data:image/png;base64,${'x'.repeat(20_000)}`
  }))
  const result = prepareChatDetailForRenderer({
    id: 'chat',
    items: [{ type: 'message', id: 'user', role: 'user', content: '', attachments }]
  })
  const message = result.items[0]

  assert.equal(message.attachments.length, rendererMessageAttachmentLimit)
  assert.ok(message.attachments.every((attachment) => attachment.dataUrl === null))
  assert.equal(message.payloadTruncated, true)
})

test('bounds a pathological latest working step by items and retained payload', () => {
  const latest = workingStep('latest', 1_435)
  latest.items.forEach((item) => {
    item.content = 'x'.repeat(100_000)
  })

  const result = unloadHistoricalWorkingSteps({ id: 'chat', items: [latest] })
  const bounded = result.items[0]
  assert.equal(bounded.items.length, 50)
  assert.equal(bounded.itemsStartIndex, 1_385)
  assert.equal(bounded.itemCount, 1_435)
  assert.ok(
    bounded.items.reduce((total, item) => total + getWorkingItemPayloadCharacterCount(item), 0) <=
      rendererWorkingPagePayloadBudgetCharacters
  )
  assert.ok(bounded.items.some((item) => item.contentLoaded === false))
})

test('returns bounded working-item pages with stable logical offsets', () => {
  const step = workingStep('step', 120)
  const page = prepareWorkingStepPage(step, 50, 50)

  assert.equal(page.workingStepId, 'step')
  assert.equal(page.startIndex, 50)
  assert.equal(page.totalCount, 120)
  assert.equal(page.items.length, 50)
  assert.equal(page.items[0].id, 'step:item:50')
  assert.equal(page.items.at(-1).id, 'step:item:99')
})

test('loads the real final activity page when a stale renderer count requests past EOF', () => {
  const step = workingStep('step', 12)
  const page = prepareWorkingStepPage(step, 50, 50)

  assert.equal(page.startIndex, 0)
  assert.equal(page.totalCount, 12)
  assert.equal(page.items.length, 12)
  assert.equal(page.items[0].id, 'step:item:0')
  assert.equal(page.items.at(-1).id, 'step:item:11')
})

test('returns only a bounded preview for one oversized tool payload', () => {
  const item = {
    type: 'tool',
    id: 'item',
    toolId: 'exec',
    status: 'finished',
    activity: 'command',
    icon: null,
    label: 'Ran command',
    command: 'x'.repeat(400_000),
    cwd: null,
    stdout: 'y'.repeat(400_000),
    diffs: [],
    backgroundSessionId: null,
    finishedBackgroundSessionId: null,
    rawInput: null,
    rawOutput: null,
    images: []
  }

  const result = limitWorkingItemPayload(item)
  assert.equal(result.payloadLoaded, true)
  assert.equal(result.payloadTruncated, true)
  assert.ok(getWorkingItemPayloadCharacterCount(result) < 300_000)
  assert.equal(result.payloadCharacterCount, 800_000)
})

test('bounds nested tools inside one grouped working item', () => {
  const tool = {
    type: 'tool',
    id: 'tool',
    toolId: 'read',
    status: 'finished',
    activity: 'read',
    icon: null,
    label: 'Read',
    command: null,
    cwd: null,
    stdout: null,
    diffs: [],
    backgroundSessionId: null,
    finishedBackgroundSessionId: null,
    rawInput: null,
    rawOutput: null,
    images: []
  }
  const group = {
    type: 'toolGroup',
    id: 'group',
    label: 'Parallel reads',
    tools: Array.from({ length: 7_868 }, (_, index) => ({ ...tool, id: `tool-${index}` }))
  }

  const result = limitWorkingItemPayload(group)
  assert.equal(result.tools.length, 50)
  assert.equal(result.toolCount, 7_868)
  assert.equal(result.toolsStartIndex, 7_818)
  assert.equal(result.tools[0].id, 'tool-7818')

  const page = prepareWorkingStepPage(
    { type: 'working', id: 'step', status: 'worked', items: [group] },
    0,
    50
  )
  assert.equal(page.items[0].tools.length, 50)
})

test('bounds nested diff, image, and raw-data collections in tool previews', () => {
  const tool = {
    type: 'tool',
    id: 'tool',
    toolId: 'exec',
    status: 'finished',
    activity: 'command',
    icon: null,
    label: 'Large result',
    command: null,
    cwd: null,
    stdout: null,
    diffs: Array.from({ length: 1_000 }, (_, index) => ({
      path: `file-${index}`,
      kind: 'edit',
      diff: `diff-${index}`
    })),
    backgroundSessionId: null,
    finishedBackgroundSessionId: null,
    rawInput: null,
    rawOutput: Array.from({ length: 20_000 }, (_, index) => index),
    images: Array.from({ length: 1_000 }, (_, index) => ({
      name: `image-${index}`,
      dataUrl: `data:image/png;base64,${index}`
    }))
  }

  const preview = limitWorkingItemPayload(tool)
  assert.equal(preview.diffs.length, 200)
  assert.equal(preview.diffCount, 1_000)
  assert.equal(preview.diffsStartIndex, 800)
  assert.equal(preview.images.length, 50)
  assert.equal(preview.imageCount, 1_000)
  assert.equal(preview.imagesStartIndex, 950)
  assert.equal(preview.rawOutput.length, 201)
  assert.equal(preview.payloadTruncated, true)

  const page = prepareWorkingStepPage(
    { type: 'working', id: 'step', status: 'worked', items: [tool] },
    0,
    50
  )
  assert.equal(page.items[0].diffs.length, 0)
  assert.equal(page.items[0].images.length, 0)
  assert.equal(page.items[0].rawOutput, null)
  assert.equal(page.items[0].payloadLoaded, false)
})
