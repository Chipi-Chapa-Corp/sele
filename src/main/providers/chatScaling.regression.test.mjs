import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatItems } from './codex/CodexItemRenderers.ts'
import { renderClaudeChatItems } from './claude/ClaudeItemRenderers.ts'
import { renderCopilotChatItems } from './copilot/CopilotItemRenderers.ts'
import { renderOpenCodeChatItems } from './opencode/OpenCodeItemRenderers.ts'
import { sliceProviderChatTurns } from '../../shared/chatTurns.ts'
import { appendProviderConversationSegment } from './ProviderConversationEngine.ts'
import { prepareWorkingStepPage, groupWorkingItemsForRenderer } from './workingStepLazy.ts'
import { mergeWorkingStepPage } from '../../renderer/src/chatDetailWindow.ts'

// Deliberately count payload access instead of timing. Indexing lightweight turn boundaries
// is allowed; reading/rendering every old assistant payload for a ten-turn page is not.
const options = { active: false, stopped: false }
const fixture = (provider, count, visit) => {
  const text = (id) => ({ get content() { visit(); return `answer ${id}` } })
  return Array.from({ length: count }, (_, i) => {
    const id = String(i)
    if (provider === 'codex') return [{ id, status: 'completed', items: [
      { id: `u${id}`, type: 'userMessage', content: [{ type: 'text', text: `prompt ${id}` }] },
      { id: `a${id}`, type: 'agentMessage', phase: 'final_answer', get text() { visit(); return `answer ${id}` } }
    ] }]
    if (provider === 'claude') return [
      { type: 'user', uuid: `u${id}`, message: { content: `prompt ${id}` }, parent_tool_use_id: null },
      { type: 'assistant', uuid: `a${id}`, parent_tool_use_id: null, get message() { visit(); return { content: [{ type: 'text', text: `answer ${id}` }] } } }
    ]
    if (provider === 'copilot') return [
      { type: 'user.message', id: `u${id}`, data: { content: `prompt ${id}` } },
      { type: 'assistant.message', id: `a${id}`, data: { messageId: `a${id}`, ...text(id), get content() { visit(); return `answer ${id}` } } }
    ]
    return [
      { info: { role: 'user', id: `u${id}`, time: { created: 0 } }, parts: [{ type: 'text', text: `prompt ${id}` }] },
      { info: { role: 'assistant', id: `a${id}`, time: { created: 0 } }, get parts() { visit(); return [{ type: 'text', id: `p${id}`, text: `answer ${id}` }] } }
    ]
  }).flat()
}
const renders = {
  codex: (records, settings) => getChatItems(records, null, settings),
  claude: renderClaudeChatItems,
  copilot: renderCopilotChatItems,
  opencode: renderOpenCodeChatItems
}
for (const [provider, render] of Object.entries(renders)) {
  test(`${provider}: ten-turn navigation does not render off-window history`, () => {
    for (const count of [200, 20000]) {
      // Separate reference objects prevent an identity cache from hiding a full conversion.
      const reference = render(fixture(provider, count, () => {}), options)
      let visited = 0
      const records = fixture(provider, count, () => { visited++ })
      visited = 0
      for (const startIndex of [count - 10, 20]) {
        visited = 0
        const result = render(records, { ...options, turnWindow: { startIndex, limit: 10 } })
        assert.ok(visited <= 100, `${provider} read ${visited} assistant payloads for 10 turns out of ${count}`)
        assert.deepEqual(result, sliceProviderChatTurns(reference, startIndex, startIndex + 10))
      }
    }
  })
}

test('codex: an unchanged huge active turn reuses its conversion on ordinary reads', () => {
  let visited = 0
  const turn = { id: 'active', status: 'inProgress', items: [
    { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'work' }] },
    ...Array.from({ length: 2000 }, (_, i) => ({ type: 'commandExecution', id: `tool${i}`, status: 'completed', aggregatedOutput: '', get command() { visited++; return 'ls' } }))
  ] }
  const first = getChatItems([turn])
  visited = 0
  const second = getChatItems([turn])
  assert.deepEqual(second, first)
  assert.equal(visited, 0, 'ordinary reads must not reconvert unchanged hidden tool payloads')
})

const tool = (id) => ({ type: 'tool', id, toolId: id, activity: 'command', status: 'finished', label: 'Run', command: 'true', stdout: '', cwd: null, diffs: [], images: [], rawInput: null, rawOutput: null })
test('row coordinates are canonical before any provider step is trimmed, then remain stable through paging', () => {
  const entries = Array.from({ length: 120 }, (_, row) => [
    ...Array.from({ length: 20 }, (_, i) => ({ kind: 'working', item: tool(`t${row}:${i}`) })),
    { kind: 'working', item: { type: 'message', id: `m${row}`, content: `reasoning ${row}` } }
  ]).flat()
  const items = []
  appendProviderConversationSegment(items, { id: 'step', entries, lifecycle: { completed: true } })
  const step = items[0]
  assert.equal(step.items.length, 240, '20 tools in one expandable must occupy one row before trimming')
  assert.equal(step.itemCount, 240)
  assert.equal(step.itemsStartIndex, 0)
  const tail = prepareWorkingStepPage(step, 190, 50)
  const older = prepareWorkingStepPage(step, 140, 50)
  const merged = mergeWorkingStepPage({ ...step, items: tail.items, itemCount: tail.totalCount, itemsStartIndex: tail.startIndex }, older, 50, 100)
  assert.equal(older.items.length, 50)
  assert.equal(groupWorkingItemsForRenderer(older.items).length, 50)
  assert.equal(merged.items.length, 100)
  assert.equal(merged.itemCount, 240)
  assert.equal(new Set(merged.items.map(item => item.id)).size, 100)
  const group = older.items.find(item => item.type === 'toolGroup')
  assert.equal(group.toolCount, 20)
})
