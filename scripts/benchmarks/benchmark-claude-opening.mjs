// Run with node --experimental-strip-types scripts/benchmarks/benchmark-claude-opening.mjs.
// Measures cold history reconstruction without launching Claude or reading real sessions.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { ClaudeHistoryPages } from '../../src/main/providers/claude/ClaudeHistoryPages.ts'

const sessionId = '11111111-1111-4111-8111-111111111111'
const entries = []
let parent = null
const add = (type, uuid, content) => {
  entries.push({
    type,
    uuid,
    parentUuid: parent,
    sessionId,
    message: { role: type, content }
  })
  parent = uuid
}
for (let turn = 0; turn < 30; turn++) {
  add('user', `u${turn}`, `Prompt ${turn}`)
  if (turn >= 20) {
    for (let tool = 0; tool < 500; tool++) {
      const id = `t${turn}-${tool}`
      add('assistant', `call-${id}`, [
        { type: 'tool_use', id, name: 'Read', input: { file_path: '/fixture' } }
      ])
      add('user', `result-${id}`, [
        { type: 'tool_result', tool_use_id: id, content: 'x'.repeat(500) }
      ])
    }
  }
  add('assistant', `a${turn}`, `Answer ${turn}`)
}
const data = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
const times = []
let bytes = 0
for (let run = 0; run < 6; run++) {
  bytes = 0
  const pages = new ClaudeHistoryPages()
  const started = performance.now()
  const page = await pages.read(
    sessionId,
    'host',
    { cursor: null, direction: 'older', limit: 10 },
    async () => ({
      identity: 'fixture',
      size: data.length,
      modified: 1,
      read: async (offset, length) => {
        bytes += length
        return data.subarray(offset, offset + length)
      },
      close: async () => {}
    })
  )
  if (run) times.push(performance.now() - started)
  assert.equal(page.messages.length, 10020)
  assert.equal(page.messages[0].uuid, 'u20')
  assert.equal(page.messages.at(-1).uuid, 'a29')
}
times.sort((a, b) => a - b)
console.log(
  JSON.stringify({
    fixture: 'ten latest turns with 500 tool calls each',
    medianMs: Number(times[2].toFixed(2)),
    readBytes: bytes,
    transcriptBytes: data.length
  })
)
