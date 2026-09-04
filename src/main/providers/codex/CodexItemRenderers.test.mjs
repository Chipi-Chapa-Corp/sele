import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatConversationModel } from '../../../renderer/src/chatConversationModel.ts'
import { getChatItems } from './CodexItemRenderers.ts'

// Test fixtures intentionally omit production-only Codex fields.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const renderFailedWorkingStep = (codexErrorInfo) => {
  const items = getChatItems([
    {
      id: `turn-${codexErrorInfo}`,
      status: 'failed',
      error: {
        message: 'Provider request failed',
        additionalDetails: null,
        codexErrorInfo
      },
      items: [
        {
          type: 'userMessage',
          id: 'user-message',
          content: [{ type: 'text', text: 'Try this' }]
        }
      ]
    }
  ])

  return items.find((item) => item.type === 'working')
}

test('marks Codex usage and rate-limit failures as resettable rate-limit turns', () => {
  assert.equal(renderFailedWorkingStep('usageLimitExceeded')?.failureReason, 'rateLimit')
  assert.equal(renderFailedWorkingStep('rateLimitExceeded')?.failureReason, 'rateLimit')
})

test('keeps the failed turn user message available for retry after a limit reset', () => {
  const userMessage = {
    type: 'message',
    id: 'user-message',
    editTargetId: 'turn-id',
    role: 'user',
    content: 'Try this'
  }
  const rateLimitedStep = {
    type: 'working',
    id: 'working-step',
    status: 'failed',
    failureReason: 'rateLimit',
    items: []
  }
  const model = buildChatConversationModel([userMessage, rateLimitedStep])

  assert.equal(model.stoppedTurnRetryMessages.get(rateLimitedStep.id), userMessage)
})

test('does not mark unrelated Codex failures as rate-limit turns', () => {
  assert.equal(renderFailedWorkingStep('serverOverloaded')?.failureReason, undefined)
})

test('does not render an orphan stopped marker for an interrupted turn with no items', () => {
  assert.deepEqual(
    getChatItems([
      {
        id: 'orphan-interrupted-turn',
        status: 'interrupted',
        items: []
      }
    ]),
    []
  )
})

test('renders a stopped marker after the submitted user message', () => {
  const items = getChatItems([
    {
      id: 'interrupted-turn',
      status: 'interrupted',
      items: [
        {
          type: 'userMessage',
          id: 'submitted-message',
          content: [{ type: 'text', text: 'Keep this message' }]
        }
      ]
    }
  ])

  assert.deepEqual(
    items.map((item) => (item.type === 'message' ? `${item.role}:${item.content}` : item.status)),
    ['user:Keep this message', 'stopped']
  )
})

test('marks an inline follow-up as a steering message', () => {
  const items = getChatItems([
    {
      id: 'steered-turn',
      status: 'completed',
      items: [
        {
          type: 'userMessage',
          id: 'initial-message',
          content: [{ type: 'text', text: 'Start here' }]
        },
        {
          type: 'userMessage',
          id: 'steering-message',
          content: [{ type: 'text', text: 'Change direction' }]
        }
      ]
    }
  ])
  const steeringMessage = items.find(
    (item) => item.type === 'message' && item.content === 'Change direction'
  )

  assert.equal(steeringMessage?.kind, 'steering')
})

test('projects the final response both while live and after completion', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const createTurn = (status) => ({
    id: 'answer-turn',
    status,
    items: [
      {
        type: 'userMessage',
        id: 'question',
        content: [{ type: 'text', text: 'Answer this' }]
      },
      {
        type: 'reasoning',
        id: 'reasoning',
        summary: ['Checking the details']
      },
      {
        type: 'agentMessage',
        id: 'answer',
        text: 'Here is the answer.',
        phase: 'final_answer'
      }
    ]
  })

  for (const status of ['inProgress', 'completed']) {
    const items = getChatItems([createTurn(status)])
    const working = items.find((item) => item.type === 'working')
    const finalMessage = items.find((item) => item.type === 'message' && item.role === 'assistant')

    assert.equal(finalMessage?.id, 'answer-turn:answer')
    assert.equal(finalMessage?.content, 'Here is the answer.')
    if (status === 'inProgress') assert.equal(working?.status, 'working')
  }
})
