import assert from 'node:assert/strict'
import test from 'node:test'
import { getChatItems, hasCompletedCodexFinalAnswer } from './CodexItemRenderers.ts'

// Test fixtures intentionally omit production-only Codex fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const userMessage = (id, text) => ({
  type: 'userMessage',
  id,
  content: [{ type: 'text', text }]
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const finalAnswer = (id, text, status = 'finished') => ({
  type: 'agentMessage',
  id,
  text,
  phase: 'final_answer',
  status
})

test('keeps a final answer visible when a steering message follows it', () => {
  const items = getChatItems([
    {
      id: 'turn-1',
      status: 'completed',
      startedAt: 1,
      completedAt: 2,
      items: [
        userMessage('user-1', 'Why?'),
        {
          type: 'agentMessage',
          id: 'commentary-1',
          text: 'I will inspect it.',
          phase: 'commentary',
          status: 'finished'
        },
        finalAnswer('answer-1', 'The first answer.'),
        userMessage('steer-1', 'It is on another server.'),
        finalAnswer('answer-2', 'The revised answer.')
      ]
    }
  ])

  assert.deepEqual(
    items.map((item) =>
      item.type === 'message'
        ? { type: item.type, role: item.role, content: item.content, label: item.label ?? null }
        : { type: item.type, status: item.status }
    ),
    [
      { type: 'message', role: 'user', content: 'Why?', label: null },
      { type: 'working', status: 'worked' },
      { type: 'message', role: 'assistant', content: 'The first answer.', label: null },
      {
        type: 'message',
        role: 'user',
        content: 'It is on another server.',
        label: 'Steering with'
      },
      { type: 'message', role: 'assistant', content: 'The revised answer.', label: null }
    ]
  )
})

test('keeps completed subagents in one parent working section', () => {
  const items = getChatItems([
    {
      id: 'turn-1',
      status: 'completed',
      startedAt: 1,
      completedAt: 2,
      items: [
        userMessage('user-1', 'Coordinate the work'),
        {
          type: 'agentMessage',
          id: 'commentary-1',
          text: 'The mapper is working.',
          phase: 'commentary',
          status: 'finished'
        },
        {
          type: 'subAgentActivity',
          id: 'activity-1',
          kind: 'completed',
          agentThreadId: 'child-1'
        },
        {
          type: 'agentMessage',
          id: 'commentary-2',
          text: 'Now I will verify its result.',
          phase: 'commentary',
          status: 'finished'
        },
        {
          type: 'subAgentActivity',
          id: 'activity-2',
          kind: 'completed',
          agentThreadId: 'child-2'
        },
        finalAnswer('answer-1', 'Everything is done.')
      ]
    }
  ])

  assert.deepEqual(
    items.map((item) => [item.type, item.id]),
    [
      ['message', 'turn-1:user-1'],
      ['working', 'turn-1:working'],
      ['timelineAnchor', 'turn-1:subagent-completed:child-1'],
      ['timelineAnchor', 'turn-1:subagent-completed:child-2'],
      ['message', 'turn-1:answer-1']
    ]
  )
})

test('creates a working section for a subagent completion without parent commentary', () => {
  const items = getChatItems([
    {
      id: 'turn-1',
      status: 'completed',
      items: [
        userMessage('user-1', 'Delegate this work'),
        {
          type: 'subAgentActivity',
          id: 'activity-1',
          kind: 'completed',
          agentThreadId: 'child-1'
        },
        finalAnswer('answer-1', 'Done.')
      ]
    }
  ])

  assert.deepEqual(
    items.map((item) => [item.type, item.id]),
    [
      ['message', 'turn-1:user-1'],
      ['working', 'turn-1:working'],
      ['timelineAnchor', 'turn-1:subagent-completed:child-1'],
      ['message', 'turn-1:answer-1']
    ]
  )
})

test('hides Codex collaboration tool calls from the parent transcript', () => {
  const items = getChatItems([
    {
      id: 'turn-1',
      status: 'completed',
      items: [
        userMessage('user-1', 'Delegate this work'),
        {
          type: 'collabAgentToolCall',
          id: 'collab-1',
          tool: 'spawnAgent',
          status: 'completed'
        },
        finalAnswer('answer-1', 'Done.')
      ]
    }
  ])

  assert.deepEqual(
    items.map((item) => [item.type, item.id]),
    [
      ['message', 'turn-1:user-1'],
      ['message', 'turn-1:answer-1']
    ]
  )
})

test('renders Codex waits as compact subagent status rows', () => {
  const activeItems = getChatItems([
    {
      id: 'turn-waiting',
      status: 'inProgress',
      items: [
        userMessage('user-waiting', 'Wait for the delegated work'),
        {
          type: 'collabAgentToolCall',
          id: 'wait-active',
          tool: 'wait',
          status: 'inProgress'
        }
      ]
    }
  ])
  const activeWorking = activeItems.find((item) => item.type === 'working')
  const activeWait = activeWorking?.items.find((item) => item.type === 'tool')

  assert.equal(activeWait?.label, 'Waited for subagent')
  assert.equal(activeWait?.status, 'running')
  assert.equal(activeWait?.icon, 'subagent')
  assert.equal(activeWait?.compact, true)
  assert.equal(activeWait?.rawInput, null)
  assert.equal(activeWait?.rawOutput, null)

  const completedItems = getChatItems([
    {
      id: 'turn-waited',
      status: 'completed',
      items: [
        userMessage('user-waited', 'Wait for the delegated work'),
        {
          type: 'collabAgentToolCall',
          id: 'wait-completed',
          tool: 'wait',
          status: 'completed'
        },
        finalAnswer('answer-waited', 'The delegated work finished.')
      ]
    }
  ])
  const completedWorking = completedItems.find((item) => item.type === 'working')
  const completedWait = completedWorking?.items.find((item) => item.type === 'tool')

  assert.equal(completedWait?.label, 'Waited for subagent')
  assert.equal(completedWait?.status, 'finished')
  assert.equal(completedWait?.icon, 'subagent')
  assert.equal(completedWait?.compact, true)
})

test('only treats a non-streaming final answer as completed', () => {
  assert.equal(
    hasCompletedCodexFinalAnswer({
      id: 'turn-1',
      items: [finalAnswer('answer-1', 'Still streaming', 'running')]
    }),
    false
  )
  assert.equal(
    hasCompletedCodexFinalAnswer({
      id: 'turn-1',
      items: [finalAnswer('answer-1', 'Delivered')]
    }),
    true
  )
  assert.equal(
    hasCompletedCodexFinalAnswer({
      id: 'turn-1',
      items: [finalAnswer('answer-1', '')]
    }),
    true
  )
})

test('distinguishes a provider failure from an interrupted turn', () => {
  const failedItems = getChatItems([
    {
      id: 'turn-failed',
      status: 'failed',
      error: {
        message: "You've hit your usage limit for GPT-5.3-Codex-Spark.",
        codexErrorInfo: 'usageLimitExceeded'
      },
      items: [userMessage('user-failed', 'Create a commit')]
    }
  ])
  const interruptedItems = getChatItems([
    {
      id: 'turn-interrupted',
      status: 'interrupted',
      items: [userMessage('user-interrupted', 'Create a commit')]
    }
  ])

  const failedStep = failedItems.findLast((item) => item.type === 'working')
  assert.equal(failedStep?.status, 'failed')
  assert.equal(
    failedStep?.items.at(-1)?.content,
    "You've hit your usage limit for GPT-5.3-Codex-Spark."
  )
  assert.equal(interruptedItems.findLast((item) => item.type === 'working')?.status, 'stopped')
})

test('keeps a bounded logical activity sequence in live renderer snapshots', () => {
  const turn = {
    id: 'turn-tools',
    status: 'inProgress',
    startedAt: 1,
    items: [
      userMessage('user-tools', 'Run checks'),
      ...Array.from({ length: 85 }, (_, index) => ({
        type: 'commandExecution',
        id: `command-${index}`,
        command: `echo ${index}`,
        aggregatedOutput: `${index}`,
        status: 'finished'
      }))
    ]
  }

  const items = getChatItems([turn], null, {
    workingItemTailTurnId: turn.id,
    workingItemTailLimit: 50
  })
  const working = items.find((item) => item.type === 'working')
  const sequence = working.items[0]

  assert.equal(working.itemCount, 1)
  assert.equal(working.itemsStartIndex, 0)
  assert.equal(working.items.length, 1)
  assert.equal(sequence.type, 'toolGroup')
  assert.equal(sequence.toolCount, 85)
  assert.equal(sequence.tools.length, 50)
  assert.equal(sequence.toolsStartIndex, 35)
})
