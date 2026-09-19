import assert from 'node:assert/strict'
import test from 'node:test'
import { renderClaudeChatItems, renderClaudeChatWindow } from './claude/ClaudeItemRenderers.ts'
import { renderCopilotChatItems, renderCopilotChatWindow } from './copilot/CopilotItemRenderers.ts'
import {
  renderOpenCodeChatItems,
  renderOpenCodeChatWindow
} from './opencode/OpenCodeItemRenderers.ts'
import { getProviderChatTurnCount, sliceProviderChatTurns } from '../../shared/chatTurns.ts'
import { markTranscriptRecordsChanged } from './transcriptProjection/recordChanges.ts'
import { renderNativeTurnWindow } from './transcriptProjection/turnWindow.ts'

const settings = {
  active: true,
  stopped: false,
  pendingItems: [{ type: 'pendingMessage', id: 'pending', kind: 'queued', content: 'next' }]
}
const providers = [
  [
    'claude',
    renderClaudeChatItems,
    renderClaudeChatWindow,
    Array.from({ length: 3 }, (_, i) => [
      { type: 'user', uuid: `u${i}`, message: { content: 'prompt' }, parent_tool_use_id: null },
      {
        type: 'assistant',
        uuid: `a${i}`,
        message: { content: [{ type: 'thinking', thinking: 'thinking' }] },
        parent_tool_use_id: null
      }
    ]).flat()
  ],
  [
    'copilot',
    renderCopilotChatItems,
    renderCopilotChatWindow,
    Array.from({ length: 3 }, (_, i) => [
      { type: 'user.message', id: `u${i}`, data: { content: 'prompt' } },
      { type: 'assistant.reasoning', id: `a${i}`, data: { content: 'thinking' } }
    ]).flat()
  ],
  [
    'opencode',
    renderOpenCodeChatItems,
    renderOpenCodeChatWindow,
    Array.from({ length: 3 }, (_, i) => [
      {
        info: { role: 'user', id: `u${i}`, time: { created: 0 } },
        parts: [{ type: 'text', text: 'prompt' }]
      },
      {
        info: { role: 'assistant', id: `a${i}`, time: { created: 0 } },
        parts: [{ id: `p${i}`, type: 'reasoning', text: 'thinking' }]
      }
    ]).flat()
  ]
]
for (const [name, full, window, records] of providers) {
  test(`${name}: windows preserve lifecycle, pending messages, and absolute coordinates`, () => {
    const expected = full(records, settings)
    for (const start of [0, 1, 2, 3, 4]) {
      const result = window(records, settings, { startIndex: start, limit: 1 })
      assert.equal(result.turnCount, getProviderChatTurnCount(expected))
      assert.equal(result.itemsStartTurnIndex, start)
      assert.deepEqual(result.items, sliceProviderChatTurns(expected, start, start + 1))
    }
    assert.deepEqual(
      window(records, settings, { startIndex: null, limit: 2 }).items,
      sliceProviderChatTurns(expected, 2, 4)
    )
  })
}

test('Copilot historical tool images retain binary assets stored in other turns', () => {
  const records = [
    { type: 'user.message', id: 'first', data: { content: 'first' } },
    {
      type: 'session.binary_asset',
      id: 'asset-event',
      data: { assetId: 'image', data: 'YWJj', mimeType: 'image/png' }
    },
    { type: 'user.message', id: 'second', data: { content: 'second' } },
    {
      type: 'tool.execution_start',
      id: 'start',
      data: { toolCallId: 'tool', toolName: 'image', arguments: {} }
    },
    {
      type: 'tool.execution_complete',
      id: 'complete',
      data: { toolCallId: 'tool', result: { binaryResultsForLlm: [{ assetId: 'image' }] } }
    },
    { type: 'user.message', id: 'third', data: { content: 'third' } }
  ]
  const options = { active: false, stopped: false }
  assert.deepEqual(
    renderCopilotChatWindow(records, options, { startIndex: 1, limit: 1 }).items,
    sliceProviderChatTurns(renderCopilotChatItems(records, options), 1, 2)
  )
})

test('native boundary indexing reuses a known append prefix and invalidates changed boundaries', () => {
  let visits = 0
  const classify = (record) => {
    visits++
    return record.user ? 'start' : 'content'
  }
  const render = (records) =>
    records.map((record) => ({
      type: 'message',
      role: record.user ? 'user' : 'assistant',
      id: record.id,
      content: record.id
    }))
  const options = { active: false, stopped: false }
  const original = Array.from({ length: 20000 }, (_, i) => ({ id: String(i), user: i % 2 === 0 }))
  renderNativeTurnWindow(original, options, { startIndex: null, limit: 10 }, classify, render)
  const appended = [...original, { id: 'new', user: true }]
  markTranscriptRecordsChanged(original, appended, original.length)
  visits = 0
  const result = renderNativeTurnWindow(
    appended,
    options,
    { startIndex: null, limit: 10 },
    classify,
    render
  )
  assert.equal(visits, 1)
  assert.equal(result.turnCount, 10001)
  const replacement = appended.slice()
  replacement[19998] = { id: 'changed', user: false }
  markTranscriptRecordsChanged(appended, replacement, 19998)
  const changed = renderNativeTurnWindow(
    replacement,
    options,
    { startIndex: null, limit: 10 },
    classify,
    render
  )
  assert.equal(changed.turnCount, 10000)
})

test('provider startup/control records do not create phantom history turns', () => {
  const cases = [
    [
      renderClaudeChatItems,
      renderClaudeChatWindow,
      [
        { type: 'system', uuid: 'init', message: { subtype: 'init' } },
        { type: 'user', uuid: 'u', message: { content: 'prompt' }, parent_tool_use_id: null }
      ]
    ],
    [
      renderCopilotChatItems,
      renderCopilotChatWindow,
      [
        { type: 'assistant.turn_start', id: 'start', data: {} },
        { type: 'user.message', id: 'u', data: { content: 'prompt' } }
      ]
    ]
  ]
  for (const [render, window, records] of cases) {
    const options = { active: false, stopped: false }
    const expected = render(records, options)
    const actual = window(records, options, { startIndex: 0, limit: 1 })
    assert.equal(actual.turnCount, getProviderChatTurnCount(expected))
    assert.deepEqual(actual.items, expected)
  }
})
