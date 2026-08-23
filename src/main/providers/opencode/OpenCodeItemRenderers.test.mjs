import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getOpenCodeDisplayTitle,
  getOpenCodeErrorMessage,
  renderOpenCodeChatItems
} from './OpenCodeItemRenderers.ts'

const sessionID = 'session-1'

test('uses the first user message while an OpenCode title is still pending', () => {
  const messages = [
    {
      info: {
        id: 'user-title',
        sessionID,
        role: 'user',
        time: { created: 10 },
        agent: 'build',
        model: { providerID: 'opencode', modelID: 'model' }
      },
      parts: [
        {
          id: 'synthetic-title-text',
          sessionID,
          messageID: 'user-title',
          type: 'text',
          text: 'Hidden instructions',
          synthetic: true
        },
        {
          id: 'title-text',
          sessionID,
          messageID: 'user-title',
          type: 'text',
          text: '  Fix the chat title\nwhile OpenCode generates one  '
        }
      ]
    }
  ]

  assert.equal(
    getOpenCodeDisplayTitle('New session - 2026-08-23T00:28:55.451Z', messages),
    'Fix the chat title while OpenCode generates one'
  )
  assert.equal(getOpenCodeDisplayTitle('Generated title', messages), 'Generated title')
})

test('bounds the temporary OpenCode title to the sidebar title limit', () => {
  const messages = [
    {
      info: {
        id: 'user-long-title',
        sessionID,
        role: 'user',
        time: { created: 10 },
        agent: 'build',
        model: { providerID: 'opencode', modelID: 'model' }
      },
      parts: [
        {
          id: 'long-title-text',
          sessionID,
          messageID: 'user-long-title',
          type: 'text',
          text: 'A'.repeat(100)
        }
      ]
    }
  ]
  const title = getOpenCodeDisplayTitle('New session - 2026-08-23T00:28:55.451Z', messages)

  assert.equal(title.length, 80)
  assert.equal(title, `${'A'.repeat(79)}…`)
})

test('renders a persisted OpenCode network error with a friendly message', () => {
  const items = renderOpenCodeChatItems(
    [
      {
        info: {
          id: 'user-failed',
          sessionID,
          role: 'user',
          time: { created: 10 },
          agent: 'build',
          model: { providerID: 'openai', modelID: 'gpt' }
        },
        parts: [
          {
            id: 'user-failed-text',
            sessionID,
            messageID: 'user-failed',
            type: 'text',
            text: 'Continue'
          }
        ]
      },
      {
        info: {
          id: 'assistant-failed',
          sessionID,
          role: 'assistant',
          parentID: 'user-failed',
          time: { created: 20, completed: 21 },
          providerID: 'openai',
          modelID: 'gpt',
          agent: 'build',
          path: { cwd: '/repo', root: '/repo' },
          cost: 0,
          tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: 'stop',
          error: {
            name: 'ProviderResponseStreamError',
            data: { message: 'Provider finish_reason: network_error' }
          }
        },
        parts: []
      }
    ],
    { active: false, stopped: false }
  )
  const failedStep = items.findLast((item) => item.type === 'working')

  assert.equal(failedStep?.status, 'failed')
  assert.equal(
    failedStep?.items.at(-1)?.content,
    'The connection to the model provider was interrupted. Check your network and try again.'
  )
})

test('preserves unknown OpenCode provider error details', () => {
  assert.equal(
    getOpenCodeErrorMessage({ name: 'ProviderError', data: { message: 'Account unavailable' } }),
    'Account unavailable'
  )
})

test('renders OpenCode reasoning and tools as work followed by the final answer', () => {
  const messages = [
    {
      info: {
        id: 'user-1',
        sessionID,
        role: 'user',
        time: { created: 10 },
        agent: 'build',
        model: { providerID: 'openai', modelID: 'gpt' }
      },
      parts: [
        {
          id: 'user-text',
          sessionID,
          messageID: 'user-1',
          type: 'text',
          text: 'Update the file.'
        },
        {
          id: 'user-image',
          sessionID,
          messageID: 'user-1',
          type: 'file',
          mime: 'image/png',
          filename: 'reference.png',
          url: 'data:image/png;base64,AA=='
        }
      ]
    },
    {
      info: {
        id: 'assistant-1',
        sessionID,
        role: 'assistant',
        parentID: 'user-1',
        time: { created: 20, completed: 30 },
        providerID: 'openai',
        modelID: 'gpt',
        agent: 'build',
        path: { cwd: '/repo', root: '/repo' },
        cost: 0,
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 0 } },
        finish: 'stop'
      },
      parts: [
        {
          id: 'reasoning-1',
          sessionID,
          messageID: 'assistant-1',
          type: 'reasoning',
          text: 'Inspecting the target.',
          time: { start: 21, end: 22 }
        },
        {
          id: 'tool-1',
          sessionID,
          messageID: 'assistant-1',
          type: 'tool',
          callID: 'call-1',
          tool: 'edit',
          state: {
            status: 'completed',
            input: { filePath: '/repo/app.ts' },
            output: 'Applied patch',
            title: 'Edit file',
            metadata: { path: '/repo/app.ts', diff: '@@ -1 +1 @@\n-old\n+new' },
            time: { start: 23, end: 24 }
          }
        },
        {
          id: 'answer-1',
          sessionID,
          messageID: 'assistant-1',
          type: 'text',
          text: 'The file is updated.',
          time: { start: 25, end: 29 }
        }
      ]
    }
  ]

  const items = renderOpenCodeChatItems(messages, { active: false, stopped: false })

  assert.equal(items.length, 3)
  assert.deepEqual(items[0], {
    type: 'message',
    id: 'user-1',
    role: 'user',
    content: 'Update the file.',
    attachments: [
      {
        kind: 'image',
        name: 'reference.png',
        path: null,
        dataUrl: 'data:image/png;base64,AA=='
      }
    ],
    createdAt: 10
  })
  assert.equal(items[1].type, 'working')
  assert.equal(items[1].status, 'worked')
  assert.equal(items[1].items[0].type, 'message')
  assert.equal(items[1].items[1].type, 'tool')
  assert.equal(items[1].items[1].activity, 'edit')
  assert.equal(items[1].items[1].diffs[0].path, '/repo/app.ts')
  assert.deepEqual(items[2], {
    type: 'message',
    id: 'answer-1',
    role: 'assistant',
    content: 'The file is updated.',
    createdAt: 25,
    model: 'openai/gpt'
  })
})

test('keeps an unfinished OpenCode response visibly active and appends pending messages', () => {
  const messages = [
    {
      info: {
        id: 'user-2',
        sessionID,
        role: 'user',
        time: { created: 100 },
        agent: 'build',
        model: { providerID: 'openai', modelID: 'gpt' }
      },
      parts: [
        {
          id: 'user-text-2',
          sessionID,
          messageID: 'user-2',
          type: 'text',
          text: 'Run checks.'
        }
      ]
    },
    {
      info: {
        id: 'assistant-2',
        sessionID,
        role: 'assistant',
        parentID: 'user-2',
        time: { created: 110 },
        providerID: 'openai',
        modelID: 'gpt',
        agent: 'build',
        path: { cwd: '/repo', root: '/repo' },
        cost: 0,
        tokens: { input: 1, output: 0, reasoning: 1, cache: { read: 0, write: 0 } }
      },
      parts: [
        {
          id: 'reasoning-2',
          sessionID,
          messageID: 'assistant-2',
          type: 'reasoning',
          text: 'Running the suite.',
          time: { start: 111 }
        }
      ]
    }
  ]
  const pending = {
    type: 'pendingMessage',
    id: 'pending-1',
    kind: 'queued',
    content: 'Then lint it.',
    createdAt: 120
  }

  const items = renderOpenCodeChatItems(messages, {
    active: true,
    stopped: false,
    pendingItems: [pending]
  })

  assert.equal(items[1].type, 'working')
  assert.equal(items[1].status, 'working')
  assert.deepEqual(items.at(-1), pending)
})
