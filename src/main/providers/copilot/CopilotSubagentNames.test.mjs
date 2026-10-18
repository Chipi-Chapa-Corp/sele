import assert from 'node:assert/strict'
import test from 'node:test'
import { createCopilotSubagentSummaries } from './CopilotSubagents.ts'

const event = (type, data, agentId) => ({
  type,
  id: `${type}:${agentId ?? 'root'}:${data.toolCallId ?? ''}`,
  parentId: null,
  timestamp: '2026-01-01T00:00:00.000Z',
  ...(agentId ? { agentId } : {}),
  data
})

test('Copilot subagents are named by the task description and nest under their spawner', () => {
  const events = [
    event('tool.execution_start', {
      toolCallId: 'call-root',
      toolName: 'task',
      arguments: { description: 'Map the repo', prompt: 'Read every file.', agent_type: 'explore' }
    }),
    event(
      'subagent.started',
      {
        toolCallId: 'call-root',
        agentName: 'explore',
        agentDisplayName: 'Explore Agent',
        agentDescription: ''
      },
      'agent-root'
    ),
    event(
      'tool.execution_start',
      { toolCallId: 'call-nested', toolName: 'task', arguments: { prompt: 'Check tests.' } },
      'agent-root'
    ),
    event(
      'subagent.started',
      {
        toolCallId: 'call-nested',
        agentName: 'general',
        agentDisplayName: 'General Agent',
        agentDescription: '',
        parentId: 'agent-root'
      },
      'agent-nested'
    )
  ]
  const tasks = [
    {
      type: 'agent',
      id: 'agent-root',
      description: 'Map  the\nrepo',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      agentType: 'explore',
      prompt: 'Read every file.',
      toolCallId: 'call-root'
    }
  ]
  const byId = new Map(createCopilotSubagentSummaries(events, tasks).map((s) => [s.id, s]))
  assert.equal(byId.get('agent-root').title, 'Map the repo')
  assert.equal(byId.get('agent-root').description, 'Read every file.')
  assert.equal(byId.get('agent-root').parentId, null)
  // Without a task record or description argument, the display name is the most specific name.
  assert.equal(byId.get('agent-nested').title, 'General Agent')
  assert.equal(byId.get('agent-nested').parentId, 'agent-root')
})
