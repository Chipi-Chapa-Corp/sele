import assert from 'node:assert/strict'
import test from 'node:test'
import { groupWorkingItemsForRenderer } from '../workingStepLazy.ts'
import { getConversationTailWorkingStep } from '../../../renderer/src/chatConversationModel.ts'
import { renderCopilotChatItems } from './CopilotItemRenderers.ts'

// Test fixtures intentionally omit production-only Copilot event fields.
const userMessage = (id, content, source, attachments) => ({
  type: 'user.message',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:00.000Z',
  data: { content, source, attachments }
})

const assistantMessage = (id, content, toolRequests = [], phase) => ({
  type: 'assistant.message',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:01.000Z',
  data: { content, messageId: id, toolRequests, phase }
})

const toolStart = (id, toolCallId, toolName, args = {}) => ({
  type: 'tool.execution_start',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:02.000Z',
  data: { toolCallId, toolName, arguments: args }
})

const taskComplete = (id, summary, success = true) => ({
  type: 'session.task_complete',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:03.000Z',
  data: { summary, success }
})

const reasoning = (id, content) => ({
  type: 'assistant.reasoning',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:02.000Z',
  data: { content, reasoningId: id }
})

const turnEnd = (id) => ({
  type: 'assistant.turn_end',
  id,
  parentId: null,
  timestamp: '2026-01-01T00:00:03.000Z',
  data: { turnId: id }
})

const render = (events) =>
  renderCopilotChatItems(events, {
    active: false,
    stopped: false
  })

test('keeps Copilot session errors on the failed step', () => {
  const items = render([
    userMessage('prompt', 'Help'),
    {
      type: 'session.error',
      id: 'error',
      parentId: null,
      timestamp: '2026-01-01T00:00:01.000Z',
      data: { message: 'Provider connection lost' }
    }
  ])
  assert.equal(
    items.find((item) => item.type === 'working')?.failureMessage,
    'Provider connection lost'
  )
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

test('recognizes a path-backed image when Copilot omits its MIME type', () => {
  const items = render([
    userMessage('prompt', 'Describe this image', undefined, [
      {
        type: 'file',
        path: '/tmp/pasted-image.png',
        displayName: 'pasted-image.png'
      }
    ])
  ])
  const message = items.find((item) => item.type === 'message')

  assert.equal(message?.attachments?.[0]?.kind, 'image')
  assert.equal(message?.attachments?.[0]?.path, '/tmp/pasted-image.png')
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

test('hides the Copilot tail placeholder while a final response streams', () => {
  const items = renderCopilotChatItems(
    [userMessage('prompt', 'Answer the question'), assistantMessage('answer', 'The answer.')],
    { active: true, stopped: false }
  )

  assert.deepEqual(
    items.map((item) => `${item.type}:${item.id}`),
    ['message:prompt', 'working:prompt:working', 'message:answer']
  )
  assert.equal(items[1].status, 'worked')
  assert.equal(getConversationTailWorkingStep(items), null)
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

test('keeps a completed final response when a late working event follows it', () => {
  const items = render([
    userMessage('prompt', 'Answer after investigating'),
    assistantMessage('answer', 'This is the final answer.'),
    reasoning('late-reasoning', 'Finishing some late bookkeeping.'),
    turnEnd('turn-end')
  ])
  const finalMessage = items.find((item) => item.type === 'message' && item.role === 'assistant')
  const workingStep = items.find((item) => item.type === 'working')

  assert.equal(finalMessage?.content, 'This is the final answer.')
  assert.equal(
    workingStep?.items.some(
      (item) => item.type === 'message' && item.content === 'Finishing some late bookkeeping.'
    ),
    true
  )
})

test('MCP app resources survive completion projection without embedding HTML in the descriptor', () => {
  const start = toolStart('start', 'call', 'mcp_display')
  start.data.mcpServerName = 'source'
  const end = {
    id: 'end',
    type: 'tool.execution_complete',
    timestamp: '2026-01-01T00:00:03.000Z',
    data: {
      toolCallId: 'call',
      success: true,
      result: {
        content: 'Done',
        uiResource: {
          uri: 'ui://source/app',
          mimeType: 'text/html;profile=mcp-app',
          text: '<b>App</b>'
        }
      }
    }
  }
  const items = render([userMessage('user', 'Show widget'), start, end])
  const tools = items.flatMap((item) =>
    item.type === 'working'
      ? item.items.flatMap((tool) =>
          tool.type === 'tool' ? [tool] : tool.type === 'toolGroup' ? tool.tools : []
        )
      : []
  )
  assert.deepEqual(tools[0].mcpApp, {
    callId: 'call',
    serverName: 'source',
    resourceUri: 'ui://source/app'
  })
})

test('renders Copilot subagent delegation as a compact row without its prompt or report', () => {
  const items = render([
    userMessage('user', 'Map the repo'),
    assistantMessage('assistant', '', [{ toolCallId: 'task-call', name: 'task' }]),
    toolStart('task-start', 'task-call', 'task', {
      description: 'Map the repo',
      prompt: 'Read every file and summarize.'
    }),
    {
      type: 'subagent.started',
      id: 'sub-start',
      agentId: 'agent-1',
      parentId: null,
      timestamp: '2026-01-01T00:00:02.000Z',
      data: { toolCallId: 'task-call', agentName: 'explore', agentDisplayName: 'Explore' }
    },
    {
      type: 'tool.execution_partial_result',
      id: 'task-partial',
      parentId: null,
      timestamp: '2026-01-01T00:00:02.500Z',
      data: { toolCallId: 'task-call', partialOutput: 'Reading files' }
    },
    {
      type: 'tool.execution_complete',
      id: 'task-complete',
      parentId: null,
      timestamp: '2026-01-01T00:00:02.800Z',
      data: { toolCallId: 'task-call', success: true, result: { content: 'Full subagent report' } }
    },
    assistantMessage('final', 'The repo is mapped.'),
    turnEnd('turn')
  ])
  const working = items.find((item) => item.type === 'working')
  assert.doesNotMatch(JSON.stringify(working), /Read every file|Reading files|Full subagent report/)
  const tools = working.items.flatMap((item) =>
    item.type === 'toolGroup' ? item.tools : item.type === 'tool' ? [item] : []
  )
  assert.deepEqual(
    tools.map(({ compact, icon, label, status }) => ({ compact, icon, label, status })),
    [{ compact: true, icon: 'subagent', label: 'Map the repo', status: 'finished' }]
  )
})
