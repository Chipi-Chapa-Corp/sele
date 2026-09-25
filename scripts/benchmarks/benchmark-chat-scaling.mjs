// Synthetic local CPU benchmark; no provider requests or user chat data.
// Run: node --experimental-strip-types scripts/benchmarks/benchmark-chat-scaling.mjs
import { performance } from 'node:perf_hooks'
import { updateIndexedTranscriptRecord } from '../../src/main/providers/transcriptProjection/recordChanges.ts'
import { getCodexTurnSubagents } from '../../src/main/providers/codex/CodexSubagents.ts'
import { getChatItems } from '../../src/main/providers/codex/CodexItemRenderers.ts'
import { renderClaudeChatItems } from '../../src/main/providers/claude/ClaudeItemRenderers.ts'
import {
  groupWorkingItemsForRenderer,
  prepareWorkingStepPage
} from '../../src/main/providers/workingStepLazy.ts'
import { prepareChatDetailForRenderer } from '../../src/main/providers/chatDetailLazy.ts'
import { readCodexGoalPrompts } from '../../src/main/providers/codex/CodexGoalPrompts.ts'
function ms(fn, n = 5) {
  fn()
  const times = []
  for (let i = 0; i < n; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  return +times.sort((a, b) => a - b)[Math.floor(n / 2)].toFixed(3)
}
const nativeTool = (id) => ({
  type: 'commandExecution',
  id,
  command: 'ls',
  aggregatedOutput: 'ok',
  status: 'completed'
})
for (const count of [1000, 10000, 100000]) {
  const records = Array.from({ length: count }, (_, i) => nativeTool(`t${i}`))
  const turn = {
    id: 'turn',
    status: 'inProgress',
    items: [{ type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'hi' }] }, ...records]
  }
  const claude = Array.from({ length: count }, (_, i) => ({
    type: i % 2 ? 'assistant' : 'user',
    uuid: `m${i}`,
    parent_tool_use_id: null,
    message: { content: i % 2 ? [{ type: 'text', text: 'ok' }] : 'hi' }
  }))
  const rollout = Array.from({ length: count }, () =>
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'x'.repeat(200) }]
      }
    })
  ).join('\n')
  console.log(
    JSON.stringify({
      count,
      replaceRecordMs: ms(
        () =>
          updateIndexedTranscriptRecord(records, `t${count - 1}`, (p) => ({
            ...p,
            aggregatedOutput: 'new'
          })),
        20
      ),
      appendRecordMs: ms(
        () => updateIndexedTranscriptRecord(records, 'new', () => nativeTool('new')),
        10
      ),
      subagentScanMs: ms(() => getCodexTurnSubagents([turn], 'root'), 20),
      codexFullTurnThenPageMs: ms(() =>
        prepareChatDetailForRenderer({ items: getChatItems([turn]) })
      ),
      claudeFullHistoryThenPageMs: ms(() =>
        prepareChatDetailForRenderer({
          items: renderClaudeChatItems(claude, { active: false, stopped: false })
        })
      ),
      rolloutMB: +(rollout.length / 1e6).toFixed(1),
      goalParseMs: ms(() => readCodexGoalPrompts(rollout))
    })
  )
}
const base = getChatItems([
  {
    id: 'turn',
    status: 'completed',
    items: [
      { type: 'userMessage', id: 'u', content: [{ type: 'text', text: 'hi' }] },
      ...Array.from({ length: 120 }, (_, i) => nativeTool(`t${i}`))
    ]
  }
]).find((i) => i.type === 'working')
const normal = prepareWorkingStepPage(base, 0, 50)
const partial = prepareWorkingStepPage(
  { ...base, itemCount: 120, itemsStartIndex: 20, items: base.items.slice(20, 70) },
  20,
  50
)
console.log(
  JSON.stringify({
    normalTools: 120,
    normalPageItems: normal.items.length,
    normalTotal: normal.totalCount,
    partialPageItems: partial.items.length,
    partialTotal: partial.totalCount,
    partialRenderedGroups: groupWorkingItemsForRenderer(partial.items).length
  })
)
