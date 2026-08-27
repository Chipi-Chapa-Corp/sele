import assert from 'node:assert/strict'
import test from 'node:test'
import { providerIpcChannels } from '../../shared/provider.ts'
import { createClaudeSubagentSummary } from './claude/ClaudeSubagents.ts'
import {
  createCodexSubagentSummary,
  createCodexSubagentTranscriptItems,
  getCodexSubagentAfterItemIds,
  isCodexSubagentThread,
  selectCodexSubagentTurns
} from './codex/CodexSubagents.ts'
import {
  createCopilotSubagentSummaries,
  createCopilotSubagentTranscriptItems
} from './copilot/CopilotSubagents.ts'
import {
  createOpenCodeSubagentSummary,
  isOpenCodeSubagentSession
} from './opencode/OpenCodeSubagents.ts'

test('exposes stable IPC channels for listing and reading subagents', () => {
  assert.equal(providerIpcChannels.getSubagents, 'provider:get-subagents')
  assert.equal(providerIpcChannels.getSubagent, 'provider:get-subagent')
  assert.equal(providerIpcChannels.cancelSubagent, 'provider:cancel-subagent')
})

test('maps Codex spawned threads and preserves nested parentage', () => {
  const summary = createCodexSubagentSummary(
    {
      id: 'child-2',
      parentThreadId: 'child-1',
      agentNickname: 'mapper',
      agentRole: 'researcher',
      source: {
        subAgent: { thread_spawn: { agent_path: '/root/provider_protocol' } }
      },
      preview: 'Inspect the provider protocol',
      createdAt: 10,
      updatedAt: 12,
      status: { type: 'active', activeFlags: [] }
    },
    'root'
  )

  assert.deepEqual(summary, {
    id: 'child-2',
    parentId: 'child-1',
    title: 'mapper',
    description: 'provider protocol',
    status: 'running',
    createdAt: 10_000,
    updatedAt: 12_000
  })
})

test('keeps Codex subagents out of root chat discovery', () => {
  assert.equal(
    isCodexSubagentThread({
      id: 'child',
      parentThreadId: 'root',
      source: { subAgent: { thread_spawn: { parent_thread_id: 'root' } } },
      preview: 'Original user prompt',
      createdAt: 10,
      updatedAt: 12,
      status: { type: 'idle' }
    }),
    true
  )
  assert.equal(
    isCodexSubagentThread({
      id: 'root',
      preview: 'Original user prompt',
      createdAt: 10,
      updatedAt: 12,
      status: { type: 'idle' }
    }),
    false
  )
})

test('derives a durable Codex parent transcript anchor from completion activity', () => {
  const anchors = getCodexSubagentAfterItemIds([
    {
      id: 'parent-turn',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'user', content: [] },
        { type: 'agentMessage', id: 'work-1', phase: 'commentary', text: 'Working' },
        {
          type: 'subAgentActivity',
          id: 'completed',
          kind: 'completed',
          agentThreadId: 'child-1',
          agentPath: '/root/mapper'
        },
        { type: 'agentMessage', id: 'work-2', phase: 'commentary', text: 'Continuing' },
        { type: 'agentMessage', id: 'answer', phase: 'final_answer', text: 'Done' }
      ]
    }
  ])

  assert.equal(anchors.get('child-1'), 'parent-turn:subagent-completed:child-1')
})

test('drops inherited Codex parent turns and adds the subagent task as the user message', () => {
  const parentTurn = {
    id: 'parent-turn',
    startedAt: 20,
    status: 'interrupted',
    items: [
      { type: 'userMessage', id: 'original-user', content: [] },
      {
        type: 'subAgentActivity',
        id: 'spawn',
        kind: 'started',
        agentThreadId: 'child',
        agentPath: '/root/mapper'
      }
    ]
  }
  const childTurn = {
    id: 'child-turn',
    startedAt: 20,
    status: 'completed',
    items: []
  }
  assert.deepEqual(selectCodexSubagentTurns([parentTurn, childTurn], 20), [childTurn])
  assert.deepEqual(selectCodexSubagentTurns([parentTurn], 20), [])

  const summary = {
    id: 'child',
    parentId: null,
    title: 'Mapper',
    description: 'map provider protocol',
    status: 'completed',
    createdAt: 20_000,
    updatedAt: 30_000
  }
  assert.deepEqual(
    createCodexSubagentTranscriptItems(summary, [
      { type: 'message', id: 'answer', role: 'assistant', content: 'Done' }
    ]),
    [
      {
        type: 'message',
        id: 'child:instruction',
        role: 'user',
        content: 'map provider protocol',
        createdAt: 20_000
      },
      { type: 'message', id: 'answer', role: 'assistant', content: 'Done' }
    ]
  )
})

test('derives Claude subagent labels, nesting, and timestamps from its transcript', () => {
  const summary = createClaudeSubagentSummary('agent-2', [
    {
      type: 'user',
      uuid: 'user-1',
      session_id: 'root',
      parent_tool_use_id: null,
      parent_agent_id: 'agent-1',
      timestamp: '2026-08-27T10:00:00.000Z',
      task_description: 'Check the database layer',
      message: { content: [{ type: 'text', text: 'Inspect database calls' }] }
    },
    {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'root',
      parent_tool_use_id: 'tool-1',
      parent_agent_id: 'agent-1',
      timestamp: '2026-08-27T10:00:02.000Z',
      subagent_type: 'Explore',
      message: { content: [{ type: 'text', text: 'Done' }] }
    }
  ])

  assert.equal(summary.parentId, 'agent-1')
  assert.equal(summary.title, 'Explore')
  assert.equal(summary.description, 'Check the database layer')
  assert.equal(summary.createdAt, Date.parse('2026-08-27T10:00:00.000Z'))
  assert.equal(summary.updatedAt, Date.parse('2026-08-27T10:00:02.000Z'))
})

test('merges Copilot lifecycle events with task status', () => {
  const events = [
    {
      id: 'started',
      type: 'subagent.started',
      agentId: 'agent-1',
      parentId: null,
      timestamp: '2026-08-27T10:00:00.000Z',
      data: {
        agentDescription: 'Inspect tests',
        agentDisplayName: 'Explorer',
        agentName: 'explore',
        toolCallId: 'tool-1'
      }
    },
    {
      id: 'message',
      type: 'assistant.message',
      agentId: 'agent-1',
      parentId: 'started',
      timestamp: '2026-08-27T10:00:01.000Z',
      data: { content: 'Found it', messageId: 'message-1' }
    }
  ]
  const [summary] = createCopilotSubagentSummaries(events, [
    {
      type: 'agent',
      id: 'agent-1',
      description: 'Inspect tests',
      status: 'idle',
      startedAt: '2026-08-27T10:00:00.000Z',
      agentType: 'explore',
      prompt: 'Inspect tests'
    }
  ])

  assert.equal(summary.title, 'explore')
  assert.equal(summary.description, 'Inspect tests')
  assert.equal(summary.status, 'idle')
})

test('shows the Copilot task prompt as the subagent user message', () => {
  const summary = {
    id: 'agent-1',
    parentId: null,
    title: 'explore',
    description: 'Inspect tests',
    status: 'completed',
    createdAt: 10,
    updatedAt: 20
  }
  assert.deepEqual(
    createCopilotSubagentTranscriptItems(summary, [
      { type: 'message', id: 'answer', role: 'assistant', content: 'Done' }
    ]),
    [
      {
        type: 'message',
        id: 'agent-1:instruction',
        role: 'user',
        content: 'Inspect tests',
        createdAt: 10
      },
      { type: 'message', id: 'answer', role: 'assistant', content: 'Done' }
    ]
  )
})

test('recognizes OpenCode agent children without treating ordinary forks as subagents', () => {
  const base = {
    slug: 'slug',
    projectID: 'project',
    directory: '/repo',
    version: '1',
    time: { created: 10, updated: 20 }
  }
  const subagent = {
    ...base,
    id: 'child',
    parentID: 'root',
    title: 'Explore provider support (@explore subagent)',
    agent: 'explore'
  }
  const fork = {
    ...base,
    id: 'fork',
    parentID: 'root',
    title: 'Root chat (fork #1)'
  }

  assert.equal(isOpenCodeSubagentSession(subagent), true)
  assert.equal(isOpenCodeSubagentSession(fork), false)
  assert.deepEqual(createOpenCodeSubagentSummary(subagent, 'root', { type: 'busy' }), {
    id: 'child',
    parentId: null,
    title: 'Explore provider support (@explore subagent)',
    description: 'explore',
    status: 'running',
    createdAt: 10,
    updatedAt: 20
  })
})
