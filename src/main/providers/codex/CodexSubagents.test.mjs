import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCodexSubagentTranscriptItems,
  getCodexSubagentInstruction,
  getCodexTurnSubagents
} from './CodexSubagents.ts'

test('derives subagent summaries only from the bounded parent turns', () => {
  const subagents = getCodexTurnSubagents(
    [
      {
        id: 'parent-turn',
        status: 'completed',
        startedAt: 10,
        completedAt: 12,
        items: [
          {
            type: 'subAgentActivity',
            id: 'started',
            kind: 'started',
            senderThreadId: 'root-chat',
            agentThreadId: 'child-chat',
            agentPath: '/root/repo_map',
            prompt: 'Map the repository'
          },
          {
            type: 'subAgentActivity',
            id: 'completed',
            kind: 'completed',
            senderThreadId: 'root-chat',
            agentThreadId: 'child-chat',
            agentPath: '/root/repo_map'
          }
        ]
      }
    ],
    'root-chat'
  )

  assert.deepEqual(subagents, [
    {
      id: 'child-chat',
      parentId: null,
      turnId: 'parent-turn',
      afterItemId: 'parent-turn:subagent-completed:child-chat',
      title: 'repo map',
      description: 'Map the repository',
      status: 'completed',
      createdAt: 10_000,
      updatedAt: 12_000
    }
  ])
})

test('uses parent activity state to surface a failed subagent without reading its transcript', () => {
  const [subagent] = getCodexTurnSubagents(
    [
      {
        id: 'parent-turn',
        startedAt: 20,
        items: [
          {
            type: 'subAgentActivity',
            id: 'started',
            kind: 'started',
            agentThreadId: 'child-chat',
            agentPath: '/root/check_build'
          },
          {
            type: 'collabAgentToolCall',
            id: 'wait',
            agentsStates: {
              'child-chat': { status: 'failed', message: 'Build failed' }
            }
          }
        ]
      }
    ],
    'root-chat'
  )

  assert.equal(subagent.status, 'failed')
  assert.equal(subagent.title, 'check build')
})

const summary = {
  id: 'child-chat',
  title: 'repo map',
  description: 'repo map',
  createdAt: 10_000
}

test('displays the delegated prompt instead of the refreshed name or path', () => {
  const turns = [
    {
      id: 'parent-turn',
      items: [
        { type: 'subAgentActivity', agentThreadId: 'other-child', prompt: 'Other task' },
        {
          type: 'subAgentActivity',
          agentThreadId: 'child-chat',
          prompt: 'Map the repository and report entry points.'
        },
        { type: 'subAgentActivity', agentThreadId: 'child-chat', kind: 'completed' }
      ]
    }
  ]
  const instruction = getCodexSubagentInstruction(turns, summary.id)
  const reply = {
    type: 'message',
    id: 'reply',
    role: 'assistant',
    content: 'Found the entry points.'
  }
  const items = createCodexSubagentTranscriptItems(summary, [reply], instruction)
  assert.equal(items[0].role, 'user')
  assert.equal(items[0].content, 'Map the repository and report entry points.')
  assert.equal(items[1], reply)
})

test('does not fabricate an instruction from the name when the prompt is unavailable', () => {
  const instruction = getCodexSubagentInstruction(
    [
      {
        id: 'parent-turn',
        items: [
          { type: 'subAgentActivity', agentThreadId: 'child-chat', agentPath: '/root/repo_map' }
        ]
      }
    ],
    summary.id
  )
  assert.equal(instruction, null)
  const items = []
  assert.equal(createCodexSubagentTranscriptItems(summary, items, instruction), items)
})

test('recovers the instruction from a spawn call for the matching child only', () => {
  const turns = [
    {
      items: [
        {
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          receiverThreadIds: ['other-child'],
          prompt: 'Other task'
        },
        {
          type: 'collabAgentToolCall',
          tool: 'sendInput',
          receiverThreadIds: ['child-chat'],
          prompt: 'Follow-up'
        },
        {
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          receiverThreadIds: ['child-chat'],
          prompt: 'Inspect the UI'
        }
      ]
    }
  ]
  const instruction = getCodexSubagentInstruction(turns, 'child-chat')
  assert.equal(instruction, 'Inspect the UI')
  assert.equal(createCodexSubagentTranscriptItems(summary, [], instruction)[0].role, 'user')
  assert.equal(getCodexSubagentInstruction(turns, 'missing-child'), null)
})
