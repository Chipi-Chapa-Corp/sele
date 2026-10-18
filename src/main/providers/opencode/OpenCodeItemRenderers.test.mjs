import assert from 'node:assert/strict'
import test from 'node:test'
import { renderOpenCodeChatItems } from './OpenCodeItemRenderers.ts'
import { unloadWorkingItemPayload } from '../workingStepLazy.ts'

test('reasoning keeps its own lifecycle and identity through lazy payloads', () => {
  for (const [end, completed, expected] of [
    [undefined, undefined, 'inProgress'],
    [2000, undefined, 'completed'],
    [undefined, 3000, 'completed']
  ]) {
    const items = renderOpenCodeChatItems(
      [
        {
          info: { id: 'assistant', role: 'assistant', time: { created: 1000, completed } },
          parts: [
            { type: 'reasoning', id: 'reasoning', text: ' A thought ', time: { start: 1000, end } },
            { type: 'retry', id: 'retry', attempt: 1, error: { message: 'Try again' } }
          ]
        }
      ],
      { active: true, stopped: false }
    )
    const working = items.find((item) => item.type === 'working')
    assert.equal(working.status, 'working')
    const reasoning = working.items[0]
    assert.equal(reasoning.kind, 'reasoning')
    assert.equal(reasoning.status, expected)
    const unloaded = unloadWorkingItemPayload(reasoning)
    assert.equal(unloaded.kind, 'reasoning')
    assert.equal(unloaded.status, expected)
    assert.equal(unloaded.contentLoaded, false)
    assert.equal(working.items[1].kind, undefined, 'retry text stays an ordinary progress message')
  }
})

test('aborted turns render as stopped without an error message', () => {
  const user = (id, text) => ({
    info: { id, role: 'user', time: { created: 1000 } },
    parts: [{ type: 'text', id: `${id}:text`, text }]
  })
  const items = renderOpenCodeChatItems(
    [
      user('user-1', 'First'),
      {
        info: {
          id: 'assistant',
          role: 'assistant',
          time: { created: 1100 },
          error: { name: 'MessageAbortedError', data: { message: 'The operation was aborted.' } }
        },
        parts: [{ type: 'text', id: 'partial', text: 'Partial answer' }]
      },
      user('user-2', 'Second')
    ],
    { active: false, stopped: false }
  )
  const working = items.find((item) => item.type === 'working')
  assert.equal(working?.status, 'stopped')
  assert.equal(working?.failureMessage, undefined)
  assert.equal(JSON.stringify(items).includes('The operation was aborted.'), false)
})

test('a failed turn keeps the same error item when the failed message replaces session state', () => {
  // Recorded order: session.error renders the failure from state while the assistant record
  // is still pending; the completed record with its error arrives one update later.
  const user = {
    info: { id: 'user-1', role: 'user', time: { created: 1000 } },
    parts: [{ type: 'text', id: 'user-1:text', text: 'hi' }]
  }
  const assistant = { id: 'assistant-1', role: 'assistant', time: { created: 1100 } }
  const error = { name: 'APIError', data: { message: 'invalid x-api-key', statusCode: 401 } }
  const errorItems = (messages, options) =>
    renderOpenCodeChatItems(messages, { active: false, stopped: false, ...options })
      .find((item) => item.type === 'working')
      .items.map((item) => ({ id: item.id, content: item.content }))

  const fromState = errorItems([user, { info: assistant, parts: [] }], {
    failed: true,
    failureMessage: 'invalid x-api-key'
  })
  const fromMessage = errorItems(
    [user, { info: { ...assistant, time: { created: 1100, completed: 1200 }, error }, parts: [] }],
    { failed: true, failureMessage: 'invalid x-api-key' }
  )
  assert.deepEqual(fromState, [{ id: 'user-1:working:error', content: 'invalid x-api-key' }])
  assert.deepEqual(fromMessage, fromState)

  // A second failed reply in the same turn still gets its own item.
  const twice = errorItems(
    [
      user,
      { info: { ...assistant, error }, parts: [] },
      { info: { ...assistant, id: 'assistant-2', error }, parts: [] }
    ],
    {}
  )
  assert.deepEqual(
    twice.map((item) => item.id),
    ['user-1:working:error', 'assistant-2:error']
  )
})

test('renders OpenCode subagent delegation as a compact row without its prompt or report', () => {
  const items = renderOpenCodeChatItems(
    [
      {
        info: { id: 'user', role: 'user', time: { created: 1000 } },
        parts: [{ type: 'text', id: 'user:text', text: 'Map the repo' }]
      },
      {
        info: { id: 'assistant', role: 'assistant', time: { created: 1100, completed: 1300 } },
        parts: [
          {
            type: 'tool',
            id: 'task-part',
            callID: 'task-call',
            tool: 'task',
            state: {
              status: 'completed',
              input: {
                description: 'Map the repo',
                prompt: 'Read every file and summarize.',
                subagent_type: 'explore'
              },
              output: 'Full subagent report',
              title: 'Map the repo',
              metadata: {},
              time: { start: 1100, end: 1200 }
            }
          },
          {
            type: 'subtask',
            id: 'subtask-part',
            prompt: 'Review the summary.',
            description: 'Review summary',
            agent: 'review'
          },
          { type: 'text', id: 'final', text: 'The repo is mapped.' }
        ]
      }
    ],
    { active: false, stopped: false }
  )
  const working = items.find((item) => item.type === 'working')
  assert.doesNotMatch(
    JSON.stringify(working),
    /Read every file|Full subagent report|Review the summary/
  )
  const tools = working.items.flatMap((item) =>
    item.type === 'toolGroup' ? item.tools : item.type === 'tool' ? [item] : []
  )
  assert.deepEqual(
    tools.map(({ compact, icon, label, status }) => ({ compact, icon, label, status })),
    [
      { compact: true, icon: 'subagent', label: 'Map the repo', status: 'finished' },
      { compact: true, icon: 'subagent', label: 'Review summary', status: 'finished' }
    ]
  )
})
