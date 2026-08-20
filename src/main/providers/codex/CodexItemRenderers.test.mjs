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
