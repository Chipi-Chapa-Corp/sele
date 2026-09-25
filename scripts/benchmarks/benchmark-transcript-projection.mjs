import { performance } from 'node:perf_hooks'
import {
  ClaudeTranscriptProjection,
  renderClaudeChatItems
} from '../../src/main/providers/claude/ClaudeItemRenderers.ts'
import {
  CodexTranscriptProjection,
  getChatItems
} from '../../src/main/providers/codex/CodexItemRenderers.ts'
import { updateIndexedTranscriptRecord } from '../../src/main/providers/transcriptProjection/recordChanges.ts'

// Measures conversion, not provider transport, source-array copying, IPC, or React rendering.
const median = (samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]
const measure = (read) => {
  const samples = []
  for (let i = 0; i < 25; i++) {
    const start = performance.now()
    read(i)
    samples.push(performance.now() - start)
  }
  return median(samples).toFixed(3)
}
const results = []
for (const count of [100, 10000]) {
  const codex = new CodexTranscriptProjection()
  let turn = {
    id: 'turn',
    status: 'inProgress',
    items: [
      { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'work' }] },
      ...Array.from({ length: count }, (_, i) => ({
        id: `tool${i}`,
        type: 'commandExecution',
        command: 'ls',
        aggregatedOutput: 'output',
        status: 'inProgress'
      }))
    ]
  }
  const options = { workingItemTailTurnId: 'turn', workingItemTailLimit: 50 }
  getChatItems([turn], null, options, codex)
  const samples = []
  for (let i = 0; i < 25; i++) {
    turn = {
      ...turn,
      items: updateIndexedTranscriptRecord(turn.items, `tool${count - 1}`, (item) => ({
        ...item,
        aggregatedOutput: `output ${i}`
      }))
    }
    const start = performance.now()
    getChatItems([turn], null, options, codex)
    samples.push(performance.now() - start)
  }
  results.push({
    provider: 'Codex',
    records: count,
    fullMs: measure(() => getChatItems([turn], null, options)),
    projectedMs: median(samples).toFixed(3)
  })

  const claude = new ClaudeTranscriptProjection()
  const source = [
    { type: 'user', uuid: 'user', message: { content: 'work' } },
    ...Array.from({ length: count }, (_, i) => ({
      type: 'assistant',
      uuid: `tool${i}`,
      message: {
        id: `tool${i}`,
        content: [{ type: 'tool_use', id: `tool${i}`, name: 'Bash', input: { command: 'ls' } }]
      }
    }))
  ]
  const settings = { active: true, stopped: false }
  claude.read(source, [], settings)
  const overlay = [
    {
      type: 'assistant',
      uuid: 'partial',
      message: { id: 'partial', content: [{ type: 'text', text: 'streaming' }] }
    }
  ]
  results.push({
    provider: 'Claude',
    records: count,
    fullMs: measure(() => renderClaudeChatItems([...source, ...overlay], settings)),
    projectedMs: measure(() => claude.read(source, overlay, settings))
  })
}
console.table(results)
