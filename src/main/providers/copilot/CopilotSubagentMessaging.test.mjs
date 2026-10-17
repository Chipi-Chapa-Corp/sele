import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canMessageCopilotTask,
  createCopilotSubagentSummaries,
  mergeCopilotSubagentFollowUps
} from './CopilotSubagents.ts'

const task = (overrides = {}) => ({
  type: 'agent',
  id: 'agent-1',
  toolCallId: 'call-1',
  description: 'Map repo',
  status: 'running',
  startedAt: '2026-10-17T10:00:00.000Z',
  agentType: 'explore',
  prompt: 'Latest follow-up',
  executionMode: 'background',
  ...overrides
})

test('only live background (or promotable) agents accept messages', () => {
  assert.equal(canMessageCopilotTask(task()), true)
  assert.equal(canMessageCopilotTask(task({ status: 'idle' })), true)
  assert.equal(canMessageCopilotTask(task({ status: 'completed' })), false)
  assert.equal(canMessageCopilotTask(task({ executionMode: 'sync' })), false)
  assert.equal(
    canMessageCopilotTask(task({ executionMode: 'sync', canPromoteToBackground: true })),
    true
  )
  assert.equal(canMessageCopilotTask(undefined), false)
})

test('the instruction comes from the spawning tool call, not the latest follow-up prompt', () => {
  const events = [
    {
      type: 'tool.execution_start',
      id: 'tool-start',
      parentId: null,
      timestamp: '2026-10-17T09:59:59.000Z',
      data: { toolCallId: 'call-1', toolName: 'task', arguments: { prompt: 'Map the repo' } }
    }
  ]
  const [summary] = createCopilotSubagentSummaries(events, [task()])
  assert.equal(summary.description, 'Map the repo')
  assert.equal(summary.canMessage, true)
})

test('follow-ups appear in order until a native user message records them', () => {
  const events = [
    {
      type: 'assistant.message',
      id: 'a',
      parentId: null,
      agentId: 'agent-1',
      timestamp: '2026-10-17T10:00:00.000Z',
      data: { content: 'hi' }
    },
    {
      type: 'assistant.message',
      id: 'b',
      parentId: null,
      agentId: 'agent-1',
      timestamp: '2026-10-17T10:02:00.000Z',
      data: { content: 'done' }
    }
  ]
  const followUp = {
    id: 'agent-1:follow-up:1',
    agentId: 'agent-1',
    content: 'Also check tests',
    timestamp: '2026-10-17T10:01:00.000Z'
  }
  const merged = mergeCopilotSubagentFollowUps(events, [followUp])
  assert.deepEqual(
    merged.map((event) => event.id),
    ['a', 'agent-1:follow-up:1', 'b']
  )

  const recorded = [
    ...events,
    {
      type: 'user.message',
      id: 'u',
      parentId: null,
      agentId: 'agent-1',
      timestamp: '2026-10-17T10:01:01.000Z',
      data: { content: 'Also check tests' }
    }
  ]
  assert.equal(mergeCopilotSubagentFollowUps(recorded, [followUp]), recorded)
})
