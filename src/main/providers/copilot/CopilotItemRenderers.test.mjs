import assert from 'node:assert/strict'
import test from 'node:test'
import { groupWorkingItemsForRenderer } from '../workingStepLazy.ts'
import { getConversationTailWorkingStep } from '../../../renderer/src/chatConversationModel.ts'
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
const assistantMessage = (id, content, toolRequests = [], phase) => ({
  type: 'assistant.message',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:01.000Z',
  data: { content, messageId: id, toolRequests, phase }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const toolStart = (id, toolCallId, toolName, args = {}) => ({
  type: 'tool.execution_start',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:02.000Z',
  data: { toolCallId, toolName, arguments: args }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const taskComplete = (id, summary, success = true) => ({
  type: 'session.task_complete',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:03.000Z',
  data: { summary, success }
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

test('keeps assistant commentary between tool runs in event order', () => {
  const items = render([
    userMessage('prompt', 'Make the change'),
    toolStart('read', 'read', 'read_file', { path: '/tmp/input.ts' }),
    toolStart('search', 'search', 'grep_search', { query: 'needle' }),
    assistantMessage(
      'commentary',
      'I found the relevant code. I will patch and verify it.',
      [],
      'commentary'
    ),
    toolStart('edit', 'edit', 'apply_patch', { path: '/tmp/input.ts' }),
    toolStart('git', 'git', 'git_status', {}),
    assistantMessage('final', 'The change is complete.', [], 'final_answer')
  ])
  const workingStep = items.find((item) => item.type === 'working')

  assert.deepEqual(
    workingStep?.items.map((item) =>
      item.type === 'message' ? `message:${item.content}` : `tool:${item.activity}`
    ),
    [
      'tool:read',
      'tool:search',
      'message:I found the relevant code. I will patch and verify it.',
      'tool:edit',
      'tool:git'
    ]
  )
  assert.equal(
    items.find((item) => item.type === 'message' && item.role === 'assistant')?.content,
    'The change is complete.'
  )

  const groupedItems = groupWorkingItemsForRenderer(workingStep?.items ?? [])
  assert.deepEqual(
    groupedItems.map((item) =>
      item.type === 'toolGroup'
        ? item.tools.map((tool) => tool.activity)
        : `message:${item.content}`
    ),
    [
      ['read', 'search'],
      'message:I found the relevant code. I will patch and verify it.',
      ['edit', 'git']
    ]
  )
})

test('uses Copilot phase metadata to keep terminal commentary in the working timeline', () => {
  const items = render([
    userMessage('prompt', 'Inspect the code'),
    assistantMessage('commentary', 'I am still investigating.', [], 'commentary')
  ])
  const workingStep = items.find((item) => item.type === 'working')

  assert.equal(
    workingStep?.items[0]?.type === 'message' ? workingStep.items[0].content : null,
    'I am still investigating.'
  )
  assert.equal(
    items.some((item) => item.type === 'message' && item.role === 'assistant'),
    false
  )
})

test('keeps tool-preface text inside the working timeline before execution starts', () => {
  const items = renderCopilotChatItems(
    [
      userMessage('prompt', 'Inspect the file'),
      assistantMessage('preface', 'I will inspect the file now.', [
        { name: 'read_file', arguments: { path: '/tmp/input.ts' } }
      ])
    ],
    { active: true, stopped: false }
  )
  const workingStep = items.find((item) => item.type === 'working')

  assert.deepEqual(
    workingStep?.items.map((item) => item.type),
    ['message']
  )
  assert.equal(
    workingStep?.items[0]?.type === 'message' ? workingStep.items[0].content : null,
    'I will inspect the file now.'
  )
  assert.equal(
    items.some((item) => item.type === 'message' && item.role === 'assistant'),
    false
  )
})

test('finds the live Copilot step for a tail placeholder after a final response', () => {
  const items = renderCopilotChatItems(
    [userMessage('prompt', 'Answer the question'), assistantMessage('answer', 'The answer.')],
    { active: true, stopped: false }
  )

  assert.deepEqual(
    items.map((item) => `${item.type}:${item.id}`),
    ['message:prompt', 'working:prompt:working', 'message:answer']
  )
  assert.equal(getConversationTailWorkingStep(items)?.id, 'prompt:working')
})

test('does not render a tail placeholder after Copilot becomes idle', () => {
  const items = render([
    userMessage('prompt', 'Answer the question'),
    assistantMessage('answer', 'The answer.')
  ])

  assert.equal(getConversationTailWorkingStep(items), null)
})

test('renders the task completion summary as the final Copilot response', () => {
  const items = render([
    userMessage('prompt', 'Finish the task'),
    assistantMessage('completion-call', '', [
      { name: 'task_complete', arguments: { summary: 'The task is complete.' } }
    ]),
    toolStart('completion-start', 'completion', 'task_complete', {
      summary: 'The task is complete.'
    }),
    taskComplete('completion', 'The task is complete.')
  ])

  assert.equal(
    items.find((item) => item.type === 'message' && item.role === 'assistant')?.content,
    'The task is complete.'
  )
})
