// Native event handling only: synthetic histories, no provider, profile or GUI.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import {
  applyOpenCodeMessageEvent,
  forEachOpenCodeEvent,
  queueOpenCodeMessageEvent
} from '../../src/main/providers/opencode/OpenCodeEvents.ts'

const sessionCount = 5
const tokensPerSession = 100
const results = []
for (const historySize of [1_000, 10_000, 100_000]) {
  const initial = Array.from({ length: historySize }, (_, index) => ({
    info: { id: String(index).padStart(8, '0'), role: 'assistant', time: { created: 1 } },
    parts: [{ id: 'text', type: 'text', text: '' }]
  }))
  const events = Array.from({ length: sessionCount * tokensPerSession }, (_, index) => ({
    session: index % sessionCount,
    properties: { messageID: initial.at(-1).info.id, partID: 'text', field: 'text', delta: '.' }
  }))
  const samples = { individual: [], batched: [] }
  for (let repetition = 0; repetition < 3; repetition++) {
    for (const mode of ['individual', 'batched']) {
      const states = Array.from({ length: sessionCount }, () => ({ messages: initial }))
      let previous = performance.now()
      let maxTimerGap = 0
      const timer = setInterval(() => {
        const now = performance.now()
        maxTimerGap = Math.max(maxTimerGap, now - previous)
        previous = now
      }, 1)
      await new Promise((resolve) => setTimeout(resolve, 2))
      const started = performance.now()
      let count = 0
      const visit = ({ session, properties }) => {
        const state = states[session]
        if (mode === 'batched') queueOpenCodeMessageEvent(state, 'message.part.delta', properties)
        else
          state.messages = applyOpenCodeMessageEvent(
            state.messages,
            'message.part.delta',
            properties
          )
        // Model five publication boundaries. A read seals the shared working array.
        if (++count % 100 === 0) for (const state of states) void state.messages
      }
      const stream = (async function* () {
        yield* events
      })()
      if (mode === 'batched')
        await forEachOpenCodeEvent(stream, new AbortController().signal, visit)
      else for await (const event of stream) visit(event)
      const elapsedMs = performance.now() - started
      await new Promise((resolve) => setTimeout(resolve, 2))
      clearInterval(timer)
      for (const state of states) {
        assert.equal(state.messages.at(-1).parts[0].text, '.'.repeat(tokensPerSession))
        assert.equal(state.messages[0], initial[0])
      }
      assert.equal(initial.at(-1).parts[0].text, '', 'published history must remain immutable')
      samples[mode].push({ elapsedMs, maxTimerStallMs: Math.max(0, maxTimerGap - 1) })
    }
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const summary = (mode) => ({
    elapsedMs: Number(median(samples[mode].map((sample) => sample.elapsedMs)).toFixed(3)),
    maxTimerStallMs: Number(
      median(samples[mode].map((sample) => sample.maxTimerStallMs)).toFixed(3)
    )
  })
  const result = {
    historySize,
    sessionCount,
    tokensPerSession,
    individual: summary('individual'),
    batched: summary('batched')
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
if (process.argv.includes('--assert-improvement')) {
  const largest = results.at(-1)
  assert.ok(
    largest.batched.elapsedMs < largest.individual.elapsedMs / 3,
    'at least threefold lower native event CPU time'
  )
  assert.ok(
    largest.batched.maxTimerStallMs < largest.individual.maxTimerStallMs / 3,
    'at least threefold lower main-loop stall'
  )
}
const output = process.argv.indexOf('--output')
if (output >= 0)
  await writeFile(
    process.argv[output + 1],
    JSON.stringify({ synthetic: true, includesIndexConstruction: true, results }, null, 2)
  )
