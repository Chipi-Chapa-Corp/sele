import assert from 'node:assert/strict'
import test from 'node:test'
import { applyClaudeStreamEvent } from './ClaudeStreaming.ts'
import { renderClaudeChatItems } from './ClaudeItemRenderers.ts'

const userPrompt = {
  type: 'user',
  uuid: 'user-1',
  session_id: 'session',
  message: { role: 'user', content: [{ type: 'text', text: 'Build it' }] },
  parent_tool_use_id: null
}

const streamEvent = (event) => ({
  type: 'stream_event',
  session_id: 'session',
  parent_tool_use_id: null,
  event
})

const render = (partialMessages) =>
  renderClaudeChatItems([userPrompt, ...partialMessages.values()], {
    active: true,
    stopped: false
  })

const describe = (items) =>
  items.map((item) =>
    item.type === 'working'
      ? {
          working: item.items.map((workingItem) =>
            workingItem.type === 'tool'
              ? { tool: workingItem.label, command: workingItem.command }
              : { message: workingItem.content }
          )
        }
      : { [item.role]: item.content }
  )

test('a streamed tool call appears as soon as its block starts and fills in as input arrives', () => {
  const partialMessages = new Map()
  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } })
  )
  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' }
    })
  )
  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Now let me build it:' }
    })
  )
  // Until the next block arrives, trailing text is the best guess for a final answer.
  assert.deepEqual(describe(render(partialMessages)), [
    { user: 'Build it' },
    { working: [] },
    { assistant: 'Now let me build it:' }
  ])

  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }
    })
  )
  assert.deepEqual(describe(render(partialMessages)), [
    { user: 'Build it' },
    { working: [{ message: 'Now let me build it:' }, { tool: 'Bash', command: null }] }
  ])

  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"command": "npm run bui' }
    })
  )
  assert.deepEqual(describe(render(partialMessages)), [
    { user: 'Build it' },
    {
      working: [
        { message: 'Now let me build it:' },
        { tool: 'npm run bui', command: 'npm run bui' }
      ]
    }
  ])

  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: 'ld"}' }
    })
  )
  assert.deepEqual(describe(render(partialMessages)), [
    { user: 'Build it' },
    {
      working: [
        { message: 'Now let me build it:' },
        { tool: 'npm run build', command: 'npm run build' }
      ]
    }
  ])
})

test('streamed tool ids match the ids of their persisted transcript records', () => {
  const partialMessages = new Map()
  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } })
  )
  applyClaudeStreamEvent(
    partialMessages,
    streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }
    })
  )
  const [, streamedStep] = render(partialMessages)
  const persistedStep = renderClaudeChatItems(
    [
      userPrompt,
      {
        type: 'assistant',
        uuid: 'persisted-1',
        session_id: 'session',
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]
        },
        parent_tool_use_id: null
      }
    ],
    { active: true, stopped: false }
  )[1]
  assert.equal(streamedStep.items[0].id, persistedStep.items[0].id)
})
