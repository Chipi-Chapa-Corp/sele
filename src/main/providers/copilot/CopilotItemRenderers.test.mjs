import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendCopilotToolOutput,
  getBoundedCopilotRawToolValue,
  truncateCopilotToolOutput
} from './CopilotItemRenderers.ts'

test('bounds complete and incrementally streamed Copilot tool output', () => {
  const original = `start:${'x'.repeat(200_000)}:tail`
  const complete = truncateCopilotToolOutput(original)
  const streamed = appendCopilotToolOutput(
    appendCopilotToolOutput(null, original.slice(0, 100_000)),
    original.slice(100_000)
  )

  assert.ok(complete.length < original.length)
  assert.ok(streamed.length < original.length)
  assert.ok(complete.endsWith(':tail'))
  assert.ok(streamed.endsWith(':tail'))
  assert.match(streamed, /^… \[truncated to keep the app responsive\]\n/)
})

test('bounds nested Copilot raw tool values and handles cycles', () => {
  const cyclic = {}
  cyclic.self = cyclic
  cyclic.output = 'x'.repeat(100_000)

  const bounded = getBoundedCopilotRawToolValue(cyclic)

  assert.equal(bounded.self, '[Circular]')
  assert.ok(bounded.output.length < cyclic.output.length)
  assert.match(bounded.output, /truncated to keep the app responsive/)
})
