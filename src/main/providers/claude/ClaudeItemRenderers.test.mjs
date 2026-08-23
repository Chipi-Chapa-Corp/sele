import assert from 'node:assert/strict'
import test from 'node:test'
import { renderClaudeChatItems } from './ClaudeItemRenderers.ts'

// Test fixtures intentionally stay structurally flexible across SDK message variants.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const message = (type, uuid, content, extras = {}) => ({
  type,
  uuid,
  session_id: 'session-1',
  message: {
    role: type === 'assistant' ? 'assistant' : 'user',
    content,
    ...(type === 'assistant' ? { model: 'claude-sonnet-test' } : {})
  },
  parent_tool_use_id: null,
  ...extras
})

test('renders Claude reasoning, tools, results, and the final response as one turn', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Inspect the project'),
      message('assistant', 'assistant-1', [
        { type: 'thinking', thinking: 'I should inspect the package metadata.' },
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'npm test' } }
      ]),
      message('user', 'tool-result-1', [
        { type: 'tool_result', tool_use_id: 'tool-1', content: '64 tests passed' }
      ]),
      message('assistant', 'assistant-2', [{ type: 'text', text: 'Everything passes.' }])
    ],
    { active: false, stopped: false }
  )

  assert.equal(items.length, 3)
  assert.deepEqual(items[0], {
    type: 'message',
    id: 'user-1',
    role: 'user',
    content: 'Inspect the project',
    attachments: undefined,
    createdAt: null,
    label: null
  })
  assert.equal(items[1].type, 'working')
  assert.equal(items[1].status, 'worked')
  assert.equal(items[1].items[0].content, 'I should inspect the package metadata.')
  assert.deepEqual(
    {
      status: items[1].items[1].status,
      activity: items[1].items[1].activity,
      label: items[1].items[1].label,
      command: items[1].items[1].command,
      stdout: items[1].items[1].stdout
    },
    {
      status: 'finished',
      activity: 'npm',
      label: 'npm test',
      command: 'npm test',
      stdout: '64 tests passed'
    }
  )
  assert.deepEqual(items[2], {
    type: 'message',
    id: 'assistant-2',
    role: 'assistant',
    content: 'Everything passes.',
    createdAt: null,
    model: 'claude-sonnet-test'
  })
})

test('renders a Claude provider error as failed instead of stopped', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-failed', 'Continue'),
      {
        ...message('system', 'error-failed', 'Usage limit reached'),
        failed: true
      }
    ],
    { active: false, stopped: false, failed: true }
  )
  const failedStep = items.findLast((item) => item.type === 'working')

  assert.equal(failedStep?.status, 'failed')
  assert.equal(failedStep?.items.at(-1)?.content, 'Usage limit reached')
})

test('keeps Claude questions out of raw tool details and exposes their state', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Ask me'),
      message('assistant', 'assistant-1', [
        {
          type: 'tool_use',
          id: 'question-1',
          name: 'AskUserQuestion',
          input: { questions: [{ question: 'Which option?' }] }
        }
      ])
    ],
    { active: true, stopped: false }
  )

  assert.equal(items[1].type, 'working')
  assert.equal(items[1].status, 'working')
  assert.deepEqual(
    {
      icon: items[1].items[0].icon,
      label: items[1].items[0].label,
      rawInput: items[1].items[0].rawInput
    },
    { icon: 'question', label: 'Asking question', rawInput: null }
  )
})

test('renders pending Claude messages after the active turn', () => {
  const pending = {
    type: 'pendingMessage',
    id: 'queued-1',
    kind: 'queued',
    content: 'Then run lint'
  }
  const items = renderClaudeChatItems([message('user', 'user-1', 'Run tests')], {
    active: true,
    stopped: false,
    pendingItems: [pending]
  })

  assert.equal(items.at(-1), pending)
})

test('keeps forwarded subagent text and tools inside the working step', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', [{ type: 'text', text: 'Investigate this' }]),
      message('assistant', 'assistant-agent', [
        { type: 'tool_use', id: 'agent-1', name: 'Agent', input: { prompt: 'Inspect it' } }
      ]),
      {
        ...message('assistant', 'assistant-child', [
          { type: 'text', text: 'The child found the cause.' },
          { type: 'tool_use', id: 'read-child', name: 'Read', input: { file_path: '/tmp/a.ts' } }
        ]),
        parent_tool_use_id: 'agent-1'
      },
      message('assistant', 'assistant-final', [{ type: 'text', text: 'Fixed.' }])
    ],
    { active: false, stopped: false }
  )

  assert.equal(items.length, 3)
  assert.equal(items[1].type, 'working')
  assert.equal(
    items[1].items.some((item) => item.type === 'message' && item.content.includes('child')),
    true
  )
  assert.equal(
    items[1].items.some((item) => item.type === 'tool' && item.toolId === 'read-child'),
    true
  )
  assert.equal(items[2].type, 'message')
  assert.equal(items[2].content, 'Fixed.')
})

test('preserves text, tools, and thinking in Claude transcript order', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Inspect this'),
      message('assistant', 'assistant-preface', [
        { type: 'text', text: 'I will inspect the project.' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/app.ts' } }
      ]),
      message('user', 'tool-result-1', [
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'source' }
      ]),
      message('assistant', 'assistant-final', [
        { type: 'thinking', thinking: 'The source explains it.' },
        { type: 'text', text: 'Here is the result.' }
      ])
    ],
    { active: false, stopped: false }
  )

  assert.equal(items[1].type, 'working')
  assert.deepEqual(
    items[1].items.map((item) => (item.type === 'message' ? item.content : item.toolId)),
    ['I will inspect the project.', 'tool-1', 'The source explains it.']
  )
  assert.equal(items[2].type, 'message')
  assert.equal(items[2].content, 'Here is the result.')
})

test('does not render an empty streaming tool before its arguments arrive', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Inspect this'),
      message('assistant', 'api-message-1:partial', [
        { type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }
      ])
    ],
    { active: true, stopped: false }
  )

  assert.equal(items[1].type, 'working')
  assert.deepEqual(items[1].items, [])
})

test('finishes the working section when Claude starts streaming its response', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Inspect this'),
      message('assistant', 'assistant-tool', [
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/app.ts' } }
      ]),
      message('user', 'tool-result-1', [
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'source' }
      ]),
      message('assistant', 'api-message-1:partial', [
        { type: 'text', text: 'Here is what I found so far.' }
      ])
    ],
    { active: true, stopped: false }
  )

  assert.equal(items[1].type, 'working')
  assert.equal(items[1].status, 'worked')
  assert.equal(items[2].type, 'message')
  assert.equal(items[2].content, 'Here is what I found so far.')
})

test('reactivates working if Claude starts another tool after streamed text', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Inspect this'),
      message('assistant', 'api-message-1:partial', [
        { type: 'text', text: 'I need to check one more thing.' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/app.ts' } }
      ])
    ],
    { active: true, stopped: false }
  )

  assert.equal(items[1].type, 'working')
  assert.equal(items[1].status, 'working')
  assert.deepEqual(
    items[1].items.map((item) => item.type),
    ['message', 'tool']
  )
  assert.equal(
    items.some((item) => item.type === 'message' && item.role === 'assistant'),
    false
  )
})

test('does not render Claude interrupt metadata as a user message', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Inspect this'),
      message('assistant', 'assistant-1', [{ type: 'text', text: 'I started inspecting it.' }]),
      message(
        'user',
        'synthetic-interrupt',
        [{ type: 'text', text: '[Request interrupted by user]' }],
        { isSynthetic: true }
      )
    ],
    { active: false, stopped: true }
  )

  assert.equal(
    items.some((item) => item.id === 'synthetic-interrupt'),
    false
  )
  assert.equal(items.at(-1).role, 'assistant')
  assert.equal(items.at(-1).content, 'I started inspecting it.')
})

test('does not render Claude local command output as a user message', () => {
  const items = renderClaudeChatItems(
    [
      message('user', 'user-1', 'Inspect this'),
      message(
        'user',
        'local-command-1',
        '<local-command-stdout>Set model to claude-opus-5\u001b[1m</local-command-stdout>'
      ),
      message('assistant', 'assistant-1', [{ type: 'text', text: 'Here is the result.' }])
    ],
    { active: false, stopped: false }
  )

  assert.equal(
    items.some((item) => item.id === 'local-command-1'),
    false
  )
  assert.equal(items[0].content, 'Inspect this')
  assert.equal(items.at(-1).content, 'Here is the result.')
})

test('keeps ordinary user text that only mentions the Claude interrupt marker', () => {
  const items = renderClaudeChatItems(
    [message('user', 'user-1', 'Why does it show [Request interrupted by user]?')],
    { active: false, stopped: false }
  )

  assert.equal(items[0].role, 'user')
  assert.equal(items[0].content, 'Why does it show [Request interrupted by user]?')
})
