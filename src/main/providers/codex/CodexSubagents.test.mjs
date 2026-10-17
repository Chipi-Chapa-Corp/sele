import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCodexSubagentRunOutcomes,
  createCodexSubagentTranscriptItems,
  getCodexSubagentDispatchTarget,
  getCodexSubagentRunOutcome,
  getCodexSubagentInstruction,
  getCodexSubagentParentThreadId,
  getCodexTurnSubagents
} from './CodexSubagents.ts'

test('accounting finds native parent identity in both thread and spawn metadata', () => {
  assert.equal(getCodexSubagentParentThreadId({ parentThreadId: 'root' }), 'root')
  assert.equal(
    getCodexSubagentParentThreadId({
      source: { subAgent: { threadSpawn: { parent_thread_id: 'root' } } }
    }),
    'root'
  )
  assert.equal(
    getCodexSubagentParentThreadId({
      source: { subAgent: { threadSpawn: { parentThreadId: 'root' } } }
    }),
    'root'
  )
  assert.equal(getCodexSubagentParentThreadId({ source: 'cli' }), null)
})

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

test('settles a child that failed without reporting back to its parent', () => {
  const subagents = getCodexTurnSubagents(
    [
      {
        id: 'parent-turn',
        status: 'failed',
        error: { message: 'usage limit' },
        startedAt: 10,
        completedAt: 20,
        items: [
          {
            type: 'subAgentActivity',
            id: 'started',
            kind: 'started',
            agentThreadId: 'child-chat',
            agentPath: '/root/opencode_browser'
          },
          {
            type: 'subAgentActivity',
            id: 'interacted',
            kind: 'interacted',
            agentThreadId: 'child-chat',
            agentPath: '/root/opencode_browser'
          }
        ]
      }
    ],
    'root-chat'
  )
  assert.equal(subagents[0].status, 'running')

  const outcome = getCodexSubagentRunOutcome({
    id: 'child-turn',
    status: 'failed',
    error: { message: 'usage limit' },
    startedAt: 12,
    completedAt: 23,
    items: []
  })
  assert.deepEqual(outcome, { status: 'failed', at: 23_000 })

  const [settled] = applyCodexSubagentRunOutcomes(subagents, (id) =>
    id === 'child-chat' ? outcome : undefined
  )
  assert.equal(settled.status, 'failed')
  assert.equal(settled.updatedAt, 23_000)

  const [stillRunning] = applyCodexSubagentRunOutcomes(subagents, () => ({
    status: 'running',
    at: 23_000
  }))
  assert.equal(stillRunning.status, 'running')
})

test('identifies parent items that hand new work to a child', () => {
  const activity = (kind) => ({ type: 'subAgentActivity', id: kind, kind, agentThreadId: 'child' })
  assert.equal(getCodexSubagentDispatchTarget(activity('started')), 'child')
  assert.equal(getCodexSubagentDispatchTarget(activity('interacted')), 'child')
  assert.equal(getCodexSubagentDispatchTarget(activity('completed')), null)
  assert.equal(getCodexSubagentDispatchTarget({ type: 'agentMessage', id: 'm' }), null)
})
