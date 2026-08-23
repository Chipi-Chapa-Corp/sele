import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendCopilotToolOutput,
  getBoundedCopilotRawToolValue,
  renderCopilotChatItems,
  truncateCopilotToolOutput
} from './CopilotItemRenderers.ts'

test('renders a persisted Copilot session error as failed instead of stopped', () => {
  const items = renderCopilotChatItems(
    [
      {
        id: 'user-failed',
        type: 'user.message',
        timestamp: '2026-08-22T20:00:00.000Z',
        data: { content: 'Continue', delivery: 'immediate' }
      },
      {
        id: 'error-failed',
        type: 'session.error',
        timestamp: '2026-08-22T20:00:01.000Z',
        data: { message: 'Usage limit reached' }
      }
    ],
    { active: false, stopped: false }
  )
  const failedStep = items.findLast((item) => item.type === 'working')

  assert.equal(failedStep?.status, 'failed')
  assert.equal(failedStep?.items.at(-1)?.content, 'Usage limit reached')
})

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
