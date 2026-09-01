import assert from 'node:assert/strict'
import test from 'node:test'
import { getCodexTurnSubagents } from './CodexSubagents.ts'

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
