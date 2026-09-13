import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexGoalPrompts, getCodexGoalPrompt, readCodexGoalPrompts } from './CodexGoalPrompts.ts'
import { CodexTranscriptProjection, getChatItems } from './CodexItemRenderers.ts'
import { getProviderChatTurns } from '../../../shared/chatTurns.ts'

const goalMessage = (text = 'Continue the active goal.', turnId) => ({
  type: 'message',
  id: 'internal-goal',
  role: 'user',
  content: [
    {
      type: 'input_text',
      text: `<codex_internal_context source="goal">\n${text}\n</codex_internal_context>`
    }
  ],
  ...(turnId ? { internal_chat_message_metadata_passthrough: { turn_id: turnId } } : {})
})
const row = (type, payload) => JSON.stringify({ type, payload })
const rollout = (turnId) =>
  [
    row('event_msg', { type: 'task_started', turn_id: turnId }),
    row('response_item', goalMessage()),
    row('event_msg', { type: 'task_complete', turn_id: turnId })
  ].join('\n')
const turn = (id) => ({
  id,
  status: 'completed',
  items: [
    { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: 'Making progress' },
    { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Done' }
  ]
})

test('extracts only the goal envelope and preserves the complete prompt body', () => {
  const body =
    'Continue.\n\n<objective>Build a Moon café</objective>\n\nBudget: 100\n\nAudit the result.'
  assert.deepEqual(getCodexGoalPrompt(goalMessage(body)), { id: 'internal-goal', text: body })
  for (const value of [
    null,
    { ...goalMessage(), role: 'assistant' },
    { ...goalMessage(), content: [{ type: 'input_text', text: 'Regular user prompt' }] },
    {
      ...goalMessage(),
      content: [
        {
          type: 'input_text',
          text: '<codex_internal_context source="other">Other prompt</codex_internal_context>'
        }
      ]
    }
  ])
    assert.equal(getCodexGoalPrompt(value), null)
})

test('associates recorded goal prompts with native turns, including metadata and partial writes', () => {
  const contents = [
    rollout('goal-1'),
    '{incomplete',
    row('response_item', goalMessage('Second goal', 'goal-2')),
    row('response_item', goalMessage('Unattributed message'))
  ].join('\n')
  const prompts = readCodexGoalPrompts(contents)
  assert.deepEqual([...prompts.keys()], ['goal-1', 'goal-2'])
  assert.equal(prompts.get('goal-2').text, 'Second goal')
})

test('renders a compact goal marker before work and preserves checkpoint output', async () => {
  const store = new CodexGoalPrompts()
  const original = turn('goal')
  const thread = { id: 'thread', path: '/rollout', turns: [original] }
  let reads = 0
  const read = async () => {
    reads++
    return rollout('goal')
  }
  assert.equal(await store.load(thread, read), true)
  assert.equal(await store.load(thread, read), false)
  assert.equal(reads, 1)
  const projected = store.project(thread.id, original)
  assert.equal(store.project(thread.id, original), projected)
  assert.equal(original.goalPrompt, undefined)
  const items = getChatItems([projected])
  assert.deepEqual(
    items.map((item) => [item.type, item.role, item.label]),
    [
      ['goalContinuation', undefined, undefined],
      ['working', undefined, undefined],
      ['message', 'assistant', undefined]
    ]
  )
  assert.equal(items[0].content, undefined)
  assert.equal(items[0].startsTurn, true)
  assert.equal(getProviderChatTurns([...getChatItems([turn('previous')]), ...items]).length, 2)
  const projection = new CodexTranscriptProjection()
  const live = { ...original, status: 'inProgress' }
  getChatItems([live], null, {}, projection)
  const liveWithPrompt = store.project(thread.id, live)
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      getChatItems([liveWithPrompt], null, {}, projection),
      getChatItems([liveWithPrompt])
    )
})

test('rollout enrichment is optional and does not read files for ordinary user turns', async () => {
  const store = new CodexGoalPrompts()
  const ordinary = { ...turn('ordinary'), items: [{ type: 'userMessage', id: 'u', content: [] }] }
  const read = async () => {
    throw new Error('Unavailable')
  }
  assert.equal(await store.load({ id: 'a', turns: [turn('goal')] }, read), false)
  assert.equal(await store.load({ id: 'a', path: '/missing', turns: [turn('goal')] }, read), false)
  assert.equal(store.project('a', ordinary), ordinary)
  assert.equal(
    await store.load({ id: 'b', path: '/rollout', turns: [ordinary] }, async () => {
      assert.fail('A regular user turn must not need a rollout read')
    }),
    false
  )
})

test('raw goal events use the same prompt identity as history recovery', () => {
  const store = new CodexGoalPrompts()
  const prompt = getCodexGoalPrompt(goalMessage())
  assert.equal(store.set('thread', 'goal', prompt), true)
  assert.equal(
    store.set('thread', 'goal', readCodexGoalPrompts(rollout('goal')).get('goal')),
    false
  )
  store.clear()
  const original = turn('goal')
  assert.equal(store.project('thread', original), original)
})

test('concurrent history pages and consecutive goal turns each recover their own prompt', async () => {
  const store = new CodexGoalPrompts()
  let resolveRead
  const pending = new Promise((resolve) => {
    resolveRead = resolve
  })
  const first = store.load(
    { id: 'thread', path: '/rollout', turns: [turn('first')] },
    () => pending
  )
  const second = store.load({ id: 'thread', path: '/rollout', turns: [turn('second')] }, async () =>
    rollout('second')
  )
  resolveRead(rollout('first'))
  assert.equal(await first, true)
  assert.equal(await second, true)
  assert.ok(store.project('thread', turn('first')).goalPrompt)
  assert.ok(store.project('thread', turn('second')).goalPrompt)
})
