import assert from 'node:assert/strict'
import test from 'node:test'
import { renderCopilotChatItems } from './CopilotItemRenderers.ts'

// Test fixtures intentionally omit production-only Copilot event fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const userMessage = (id, content, source) => ({
  type: 'user.message',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:00.000Z',
  data: { content, source }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const render = (events) =>
  renderCopilotChatItems(events, {
    active: false,
    stopped: false
  })

test('hides Copilot skill context user-message events', () => {
  const items = render([
    userMessage(
      'context',
      '  <skill-context name="pdf">\nInternal skill instructions\n</skill-context>  '
    ),
    userMessage('prompt', 'Summarize the document')
  ])

  assert.deepEqual(
    items.filter((item) => item.type === 'message').map((item) => item.content),
    ['Summarize the document']
  )
})

test('hides Copilot messages marked with a skill source', () => {
  assert.deepEqual(render([userMessage('context', 'Internal skill instructions', 'skill-pdf')]), [])
})

test('keeps ordinary user messages that mention skill context markup', () => {
  const content = 'Explain this markup: <skill-context>example</skill-context>'
  const items = render([userMessage('prompt', content)])

  assert.equal(items.find((item) => item.type === 'message')?.content, content)
})
