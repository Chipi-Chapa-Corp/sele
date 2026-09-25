// Synthetic CPU/payload measurements; no provider requests or user chat data.
// Run: node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/benchmarks/benchmark-performance-hotpaths.mjs
import { performance } from 'node:perf_hooks'
import { anchorCodexCommandsByStart } from '../../src/main/providers/codex/CodexCommandStartAnchors.ts'
import { CopilotEventStore } from '../../src/main/providers/copilot/CopilotEventStore.ts'
import { reconcileProviderRecords } from '../../src/main/providers/ProviderConversationEngine.ts'
import { renderClaudeChatItems } from '../../src/main/providers/claude/ClaudeItemRenderers.ts'
import {
  prepareChatDetailForRenderer,
  prepareChatItemsForRenderer
} from '../../src/main/providers/chatDetailLazy.ts'

const median = (operation, repetitions = 7) => {
  operation()
  const samples = []
  for (let index = 0; index < repetitions; index++) {
    const started = performance.now()
    operation()
    samples.push(performance.now() - started)
  }
  return Number(
    samples.sort((first, second) => first - second)[Math.floor(samples.length / 2)].toFixed(3)
  )
}

for (const count of [1_000, 10_000, 30_000]) {
  const commands = Array.from({ length: count }, (_, index) => ({
    id: `command-${index}`,
    type: 'commandExecution'
  }))
  const items = [
    { id: 'user', type: 'userMessage' },
    ...commands.slice(0, -1),
    { id: 'answer', type: 'agentMessage', phase: 'final_answer' },
    commands.at(-1)
  ]
  const turn = { id: 'turn', status: 'completed', items }
  const chronological = new Map(items.map((item, index) => [item.id, index]))
  const reversed = new Map(items.map((item, index) => [item.id, items.length - index]))
  console.log(
    JSON.stringify({
      operation: 'codex-command-ordering',
      commands: count,
      unchangedMs: median(() => anchorCodexCommandsByStart(turn, chronological)),
      reorderedMs: median(() => anchorCodexCommandsByStart(turn, reversed))
    })
  )
}

for (const count of [1_000, 10_000, 100_000]) {
  const history = Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    timestamp: index
  }))
  const additions = Array.from({ length: 100 }, (_, index) => ({
    id: `event-${count + index}`,
    timestamp: count + index
  }))
  // Each sample includes initial index construction, publication, and the complete batch.
  const indexedMs = median(() => {
    const store = new CopilotEventStore(history, (event) => event.timestamp)
    store.seal()
    for (const event of additions) store.add(event)
    store.seal()
  }, 5)
  const reconciledMs = median(() => {
    let records = history
    for (const event of additions) {
      records = reconcileProviderRecords(records, [event], {
        authoritative: false,
        getId: (record) => record.id,
        compare: (first, second) => first.timestamp - second.timestamp
      })
    }
  }, 3)
  console.log(
    JSON.stringify({
      operation: 'copilot-event-batch',
      historyRecords: count,
      appendedRecords: additions.length,
      indexedIncludingConstructionMs: indexedMs,
      priorReconciliationMs: reconciledMs
    })
  )
}

const messages = [
  {
    type: 'user',
    uuid: 'user',
    message: { content: 'Run tools' },
    parent_tool_use_id: null
  }
]
for (let index = 0; index < 1_000; index++) {
  messages.push(
    {
      type: 'assistant',
      uuid: `assistant-${index}`,
      parent_tool_use_id: null,
      message: {
        id: `assistant-${index}`,
        content: [
          {
            type: 'tool_use',
            id: `tool-${index}`,
            name: 'Bash',
            input: { command: 'ls' }
          }
        ]
      }
    },
    {
      type: 'user',
      uuid: `result-${index}`,
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: `tool-${index}`,
            content: 'x'.repeat(10_000)
          }
        ]
      }
    }
  )
}
const items = renderClaudeChatItems(messages, { active: true, stopped: false })
console.log(
  JSON.stringify({
    operation: 'subagent-snapshot',
    tools: 1_000,
    outputCharactersPerTool: 10_000,
    priorMessageOnlyPreparationBytes: Buffer.byteLength(
      JSON.stringify(prepareChatItemsForRenderer(items))
    ),
    boundedPreparationBytes: Buffer.byteLength(
      JSON.stringify(prepareChatDetailForRenderer({ items }).items)
    )
  })
)
