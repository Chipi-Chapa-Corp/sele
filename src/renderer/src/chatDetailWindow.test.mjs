import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasProviderUserMessage,
  getChatDetailItemsStartTurnIndex,
  getChatDetailTurnCount,
  getWorkingStepItemSegments,
  mergeChatDetailTurnPage,
  mergeWorkingStepPage,
  mergeWorkingToolPage,
  mergeWorkingStepUpdate,
  retainLoadedChatDetailTurnWindow,
  shouldPreserveOptimisticTurnUntilUserMessage
} from './chatDetailWindow.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const turnItems = (startIndex, count) =>
  Array.from({ length: count }, (_, offset) => ({
    type: 'message',
    id: `user-${startIndex + offset}`,
    role: 'user',
    content: `Question ${startIndex + offset}`
  }))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const workingItems = (startIndex, count) =>
  Array.from({ length: count }, (_, offset) => ({
    type: 'message',
    id: `working-${startIndex + offset}`,
    content: `Activity ${startIndex + offset}`
  }))

test('preserves optimistic turns for providers that echo user messages asynchronously', () => {
  assert.equal(shouldPreserveOptimisticTurnUntilUserMessage('copilot'), true)
  assert.equal(shouldPreserveOptimisticTurnUntilUserMessage('opencode'), true)
  assert.equal(shouldPreserveOptimisticTurnUntilUserMessage('codex'), false)
  assert.equal(shouldPreserveOptimisticTurnUntilUserMessage('claude'), false)
})

test('does not mistake an empty working shell for an echoed user message', () => {
  assert.equal(
    hasProviderUserMessage([{ type: 'working', id: 'working', status: 'working', items: [] }]),
    false
  )
  assert.equal(
    hasProviderUserMessage([
      { type: 'message', id: 'user', role: 'user', content: 'Hello' },
      { type: 'working', id: 'working', status: 'working', items: [] }
    ]),
    true
  )
})

test('counts loaded turns when an asynchronous snapshot still reports zero turns', () => {
  const items = [
    { type: 'message', id: 'optimistic:user', role: 'user', content: 'Hello' },
    { type: 'working', id: 'optimistic:working', status: 'working', items: [] }
  ]

  assert.equal(getChatDetailTurnCount({ id: 'new-chat', items, turnCount: 0 }), 1)
})

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

test('keeps the real logical offset when a live retention window has an unloaded leading gap', () => {
  const detail = {
    id: 'chat',
    items: turnItems(90, 10),
    itemsStartTurnIndex: 90,
    turnCount: 100
  }
  const result = retainLoadedChatDetailTurnWindow(detail, {
    startIndex: 80,
    endIndex: 100,
    totalCount: 100
  })

  assert.equal(result.itemsStartTurnIndex, 90)
  assert.equal(result.items.length, 10)
  assert.deepEqual(
    result.items
      .slice(90 - result.itemsStartTurnIndex, 100 - result.itemsStartTurnIndex)
      .map((item) => item.id),
    Array.from({ length: 10 }, (_, index) => `user-${90 + index}`)
  )
})

test('replaces an active placeholder with its first live working item', () => {
  const current = {
    type: 'working',
    id: 'turn:working',
    status: 'working',
    items: [],
    itemsLoaded: true,
    itemCount: 0,
    itemsStartIndex: 0
  }
  const update = {
    type: 'working',
    id: 'turn:working',
    status: 'working',
    items: [{ type: 'message', id: 'reasoning-1', content: 'Inspecting the repository' }],
    itemsLoaded: true,
    itemCount: 1,
    itemsStartIndex: 0,
    workingItemsStartIndex: 0,
    workingItemsPrefixLastId: null
  }

  const result = mergeWorkingStepUpdate(update, current, 50, 100)

  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'reasoning-1')
  assert.equal(result.itemsStartIndex, 0)
})

test('keeps an unloaded working shell unloaded across incremental updates', () => {
  const current = {
    type: 'working',
    id: 'turn:working',
    status: 'worked',
    items: [],
    itemsLoaded: false,
    itemCount: 4,
    itemsStartIndex: 0
  }
  const update = {
    ...current,
    workingItemsStartIndex: 0,
    workingItemsPrefixLastId: null
  }

  const result = mergeWorkingStepUpdate(update, current, 50, 100)

  assert.equal(result.itemsLoaded, false)
  assert.equal(result.itemCount, 4)
  assert.equal(result.items.length, 0)
  assert.equal(result.itemsStartIndex, 0)
  assert.equal(result.itemSegments, undefined)
})

test('pins the newest working items when the 51st live item arrives', () => {
  const current = {
    type: 'working',
    id: 'turn:working',
    status: 'working',
    items: workingItems(0, 50),
    itemsLoaded: true,
    itemCount: 50,
    itemsStartIndex: 0
  }
  const update = {
    type: 'working',
    id: 'turn:working',
    status: 'working',
    items: workingItems(1, 50),
    itemsLoaded: true,
    itemCount: 51,
    itemsStartIndex: 1,
    workingItemsStartIndex: 0,
    workingItemsPrefixLastId: null
  }

  const result = mergeWorkingStepUpdate(update, current, 50, 100)
  const segments = getWorkingStepItemSegments(result, 50)

  assert.equal(result.items.length, 50)
  assert.equal(segments.length, 1)
  assert.equal(segments[0].kind, 'tail')
  assert.equal(segments[0].startIndex, 1)
  assert.equal(segments[0].items[0].id, 'working-1')
  assert.equal(segments[0].items.at(-1).id, 'working-50')
})

test('keeps a bounded history window separate from the pinned live tail', () => {
  let result = {
    type: 'working',
    id: 'turn:working',
    status: 'working',
    items: workingItems(200, 50),
    itemsLoaded: true,
    itemCount: 250,
    itemsStartIndex: 200
  }

  result = mergeWorkingStepPage(
    result,
    {
      workingStepId: result.id,
      status: result.status,
      items: workingItems(150, 50),
      startIndex: 150,
      totalCount: 250
    },
    50,
    100
  )
  result = mergeWorkingStepPage(
    result,
    {
      workingStepId: result.id,
      status: result.status,
      items: workingItems(100, 50),
      startIndex: 100,
      totalCount: 250
    },
    50,
    100
  )

  let segments = getWorkingStepItemSegments(result, 50)
  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.startIndex, segment.items.length]),
    [
      ['history', 100, 100],
      ['tail', 200, 50]
    ]
  )
  assert.equal(result.items.length, 150)

  result = mergeWorkingStepPage(
    result,
    {
      workingStepId: result.id,
      status: result.status,
      items: workingItems(50, 50),
      startIndex: 50,
      totalCount: 250
    },
    50,
    100
  )

  segments = getWorkingStepItemSegments(result, 50)
  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.startIndex, segment.items.length]),
    [
      ['history', 50, 100],
      ['tail', 200, 50]
    ]
  )
  assert.equal(result.items.length, 150)
  assert.equal(segments[0].items.at(-1).id, 'working-149')
  assert.equal(segments[1].items[0].id, 'working-200')
})

test('preserves a browsed history window while advancing the pinned live tail', () => {
  const current = {
    type: 'working',
    id: 'turn:working',
    status: 'working',
    items: [...workingItems(50, 100), ...workingItems(200, 50)],
    itemsLoaded: true,
    itemCount: 250,
    itemsStartIndex: 50,
    itemSegments: [
      { kind: 'history', startIndex: 50, items: workingItems(50, 100) },
      { kind: 'tail', startIndex: 200, items: workingItems(200, 50) }
    ]
  }
  const update = {
    type: 'working',
    id: 'turn:working',
    status: 'working',
    items: workingItems(201, 50),
    itemsLoaded: true,
    itemCount: 251,
    itemsStartIndex: 201,
    workingItemsStartIndex: 0,
    workingItemsPrefixLastId: null
  }

  const result = mergeWorkingStepUpdate(update, current, 50, 100)
  const segments = getWorkingStepItemSegments(result, 50)

  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.startIndex, segment.items.length]),
    [
      ['history', 50, 100],
      ['tail', 201, 50]
    ]
  )
  assert.equal(result.items.length, 150)
  assert.equal(segments[1].items.at(-1).id, 'working-250')
})

test('slides a bounded child window backward and forward inside a tool sequence', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const tools = (startIndex, count) =>
    Array.from({ length: count }, (_, offset) => ({
      type: 'tool',
      id: `tool-${startIndex + offset}`
    }))
  let group = {
    type: 'toolGroup',
    id: 'sequence',
    label: '',
    tools: tools(450, 50),
    toolCount: 500,
    toolsStartIndex: 450
  }

  group = mergeWorkingToolPage(
    group,
    {
      workingStepId: 'step',
      workingItemId: 'sequence',
      tools: tools(400, 50),
      startIndex: 400,
      totalCount: 500
    },
    100
  )
  assert.equal(group.toolsStartIndex, 400)
  assert.equal(group.tools.length, 100)
  assert.equal(group.tools.at(-1).id, 'tool-499')

  group = mergeWorkingToolPage(
    group,
    {
      workingStepId: 'step',
      workingItemId: 'sequence',
      tools: tools(350, 50),
      startIndex: 350,
      totalCount: 500
    },
    100
  )
  assert.equal(group.toolsStartIndex, 350)
  assert.equal(group.tools[0].id, 'tool-350')
  assert.equal(group.tools.at(-1).id, 'tool-449')

  group = mergeWorkingToolPage(
    group,
    {
      workingStepId: 'step',
      workingItemId: 'sequence',
      tools: tools(450, 50),
      startIndex: 450,
      totalCount: 500
    },
    100
  )
  assert.equal(group.toolsStartIndex, 400)
  assert.equal(group.tools[0].id, 'tool-400')
  assert.equal(group.tools.at(-1).id, 'tool-499')
})
