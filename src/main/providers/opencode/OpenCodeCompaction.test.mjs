import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findOpenCodeItemTurnWindow,
  renderOpenCodeChatItems,
  renderOpenCodeChatWindow
} from './OpenCodeItemRenderers.ts'
import { getProviderChatTurnCount, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'

const user = (id, parts) => ({
  info: { id, role: 'user', time: { created: 1000 } },
  parts
})
const text = (id, content, extra = {}) => ({ type: 'text', id, text: content, ...extra })
const assistant = (id, parts, extra = {}) => ({
  info: {
    id,
    role: 'assistant',
    time: { created: 2000, completed: 3000 },
    finish: 'stop',
    ...extra
  },
  parts
})
const thought = (id, content) => ({
  type: 'reasoning',
  id,
  text: content,
  time: { start: 2000, end: 2500 }
})
const fixture = (auto = true) => [
  user('prompt', [text('prompt-text', 'Check the reels')]),
  assistant('before', [
    thought('before-thought', 'Checking'),
    text('before-answer', 'First answer')
  ]),
  user('compact', [{ type: 'compaction', id: 'boundary', auto }]),
  assistant(
    'summary',
    [
      thought('summary-thought', 'Internal summary reasoning'),
      text('summary-text', 'Internal conversation summary')
    ],
    { summary: true }
  ),
  user('continue', [text('continue-text', 'Continue if you have next steps', { synthetic: true })]),
  assistant('resumed', [
    thought('resumed-thought', 'Checking again'),
    text('resumed-answer', 'Final answer')
  ])
]
const options = { active: false, stopped: false }

test('OpenCode compaction uses the shared marker and hides internal summary and prompt', () => {
  for (const auto of [true, false]) {
    const items = renderOpenCodeChatItems(fixture(auto), options)
    assert.deepEqual(
      items.map((item) => [item.type, item.id]),
      [
        ['message', 'prompt'],
        ['working', 'prompt:working'],
        ['message', 'before-answer'],
        ['contextCompaction', 'boundary'],
        ['working', 'resumed:working'],
        ['message', 'resumed-answer']
      ]
    )
    assert.deepEqual(
      items.filter((item) => item.type === 'working').map((item) => item.status),
      ['worked', 'worked']
    )
    assert.equal(getProviderChatTurnCount(items), 1)
    assert.doesNotMatch(JSON.stringify(items), /Internal|Continue if/)
  }
})

test('OpenCode compaction does not create phantom turns in history windows or item navigation', () => {
  const records = [
    ...fixture(),
    user('next', [text('next-text', 'Another question')]),
    assistant('next-response', [text('next-answer', 'Another answer')])
  ]
  const expected = renderOpenCodeChatItems(records, options)
  assert.equal(getProviderChatTurnCount(expected), 2)
  for (const startIndex of [0, 1, 2]) {
    const window = { startIndex, limit: 1 }
    const actual = renderOpenCodeChatWindow(records, options, window)
    assert.equal(actual.turnCount, 2)
    assert.equal(actual.itemsStartTurnIndex, startIndex)
    assert.deepEqual(actual.items, sliceProviderChatTurns(expected, startIndex, startIndex + 1))
    assert.deepEqual(
      renderOpenCodeChatItems(records, { ...options, turnWindow: window }),
      actual.items
    )
  }
  assert.deepEqual(findOpenCodeItemTurnWindow(records, 'resumed:working', 1), {
    startIndex: 0,
    limit: 1
  })
})

test('leading compaction remains visible when the original prompt is outside the transcript', () => {
  const records = fixture().slice(2)
  const expected = renderOpenCodeChatItems(records, options)
  assert.equal(expected[0].type, 'contextCompaction')
  assert.equal(getProviderChatTurnCount(expected), 1)
  const actual = renderOpenCodeChatWindow(records, options, { startIndex: null, limit: 1 })
  assert.equal(actual.turnCount, 1)
  assert.deepEqual(actual.items, expected)
  assert.deepEqual(renderOpenCodeChatWindow([records[1]], options, { limit: 1 }).items, [])
  assert.equal(renderOpenCodeChatWindow([records[1]], options, { limit: 1 }).turnCount, 0)
})

test('streaming summaries stay hidden and resumed work keeps its lifecycle', () => {
  const records = fixture().slice(0, 4)
  records[3].info.time = { created: 2000 }
  const compacting = renderOpenCodeChatItems(records, { active: true, stopped: false })
  assert.equal(compacting.at(-1).type, 'contextCompaction')
  assert.doesNotMatch(JSON.stringify(compacting), /Internal/)

  const resumed = fixture()
  resumed.at(-1).info.time = { created: 4000 }
  resumed.at(-1).parts = [
    { type: 'reasoning', id: 'live-thought', text: 'Working', time: { start: 4000 } }
  ]
  for (const [state, status] of [
    [{ active: true, stopped: false }, 'working'],
    [{ active: false, stopped: true }, 'stopped'],
    [{ active: false, stopped: false, failed: true, failureMessage: 'Request failed' }, 'failed']
  ]) {
    const items = renderOpenCodeChatItems(resumed, state)
    assert.equal(items.at(-1).status, status)
    assert.equal(items.filter((item) => item.type === 'contextCompaction').length, 1)
    assert.deepEqual(renderOpenCodeChatWindow(resumed, state, { limit: 1 }).items, items)
  }
})

test('hidden synthetic user messages do not split work, while attachment-only prompts do', () => {
  const records = [
    user('prompt', [text('prompt-text', 'Question')]),
    assistant('progress', [thought('progress-thought', 'Thinking')]),
    user('synthetic', [text('synthetic-text', 'Internal continuation', { synthetic: true })]),
    assistant('answer', [text('answer-text', 'Answer')]),
    user('attachment', [
      {
        type: 'file',
        id: 'image',
        mime: 'image/png',
        filename: 'image.png',
        url: 'data:image/png;base64,YQ=='
      }
    ])
  ]
  const items = renderOpenCodeChatItems(records, options)
  assert.deepEqual(
    items.map((item) => item.id),
    ['prompt', 'prompt:working', 'answer-text', 'attachment']
  )
  assert.equal(getProviderChatTurnCount(items), 2)
})
