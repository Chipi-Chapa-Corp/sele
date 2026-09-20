/* Test fixtures are JavaScript and intentionally omit provider-only fields. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CodexTranscriptProjection, getChatItems } from './CodexItemRenderers.ts'
import { getProviderChatTurns } from '../../../shared/chatTurns.ts'
import { mergeChatDetailTurnPage } from '../../../renderer/src/chatDetailWindow.ts'
import { markTranscriptRecordsChanged } from '../transcriptProjection/recordChanges.ts'

const user = (id) => ({ type: 'userMessage', id, content: [{ type: 'text', text: id }] })
const tool = (id) => ({
  type: 'commandExecution',
  id,
  command: 'ls',
  aggregatedOutput: '',
  status: 'inProgress'
})
const answer = (id, text, phase) => ({ type: 'agentMessage', id, text, phase })
const options = { workingItemTailTurnId: 'turn', workingItemTailLimit: 50 }
const compare = (projection, turn) =>
  assert.deepEqual(
    getChatItems([turn], null, options, projection),
    getChatItems([turn], null, options)
  )
const update = (turn, index, item) => {
  const items = turn.items.slice()
  items[index] = item
  markTranscriptRecordsChanged(turn.items, items, index)
  return { ...turn, items }
}

test('Codex hot-turn checkpoints match full reconstruction for appends, replacements and final demotion', () => {
  const projection = new CodexTranscriptProjection()
  let turn = { id: 'turn', status: 'inProgress', items: [user('u')] }
  compare(projection, turn)
  for (const item of [
    answer('a', 'looking'),
    tool('t'),
    answer('b', 'done', 'final_answer'),
    user('steer'),
    tool('t2'),
    answer('c', 'final')
  ]) {
    turn = update(turn, turn.items.length, item)
    compare(projection, turn)
    turn = update(turn, turn.items.length - 1, {
      ...item,
      text: item.text ? `${item.text} more` : undefined
    })
    compare(projection, turn)
  }
  turn = update(turn, 1, answer('a', 'late correction', 'commentary'))
  compare(projection, turn)
  compare(projection, { ...turn, items: turn.items.slice(0, 2) })
  for (const status of ['completed', 'failed', 'interrupted', 'inProgress'])
    compare(projection, { ...turn, status })
})

test('Codex ongoing-turn projection visits a bounded suffix independent of hidden history size', () => {
  for (const count of [100, 10000]) {
    const projection = new CodexTranscriptProjection()
    let turn = {
      id: 'turn',
      status: 'inProgress',
      items: [user('u'), ...Array.from({ length: count }, (_, i) => tool(`t${i}`))]
    }
    compare(projection, turn)
    const before = projection.processedRecordCount
    turn = update(turn, turn.items.length - 1, {
      ...turn.items.at(-1),
      aggregatedOutput: 'updated output'
    })
    compare(projection, turn)
    assert.equal(projection.processedRecordCount - before, 2)
    const beforeAppend = projection.processedRecordCount
    turn = update(turn, turn.items.length, answer('answer', 'hello'))
    compare(projection, turn)
    assert.equal(projection.processedRecordCount - beforeAppend, 4)
  }
})

test('Codex unknown snapshots and metadata changes never reuse stale projections', () => {
  const projection = new CodexTranscriptProjection()
  const turn = {
    id: 'turn',
    status: 'inProgress',
    items: [user('u'), tool('t'), answer('a', 'hello')]
  }
  compare(projection, turn)
  compare(projection, { ...turn, model: 'new-model', startedAt: 50, items: turn.items })
  compare(projection, { ...turn, items: [user('changed'), tool('different')] })
  projection.clear()
  compare(projection, turn)
})

test('Codex batched updates and late replacements match the reference through a mixed event sequence', () => {
  const projection = new CodexTranscriptProjection()
  let turn = { id: 'turn', status: 'inProgress', items: [user('u')] }
  compare(projection, turn)
  for (let i = 0; i < 160; i++) {
    const item =
      i % 11 === 0
        ? user(`steer${i}`)
        : i % 7 === 0
          ? answer(`final${i}`, `final ${i}`, 'final_answer')
          : i % 3 === 0
            ? answer(`text${i}`, `text ${i}`, 'commentary')
            : tool(`tool${i}`)
    turn = update(turn, turn.items.length, item)
    if (i % 5 === 0)
      turn = update(turn, turn.items.length - 1, { ...item, aggregatedOutput: 'batched' })
    compare(projection, turn)
    if (i % 13 === 0) {
      const position = Math.floor(turn.items.length / 2)
      turn = update(turn, position, {
        ...turn.items[position],
        text: 'late',
        aggregatedOutput: 'late result'
      })
      compare(projection, turn)
    }
  }
})

test('goal continuations retain turn boundaries when history pages overlap', () => {
  const turns = [
    { id: 'prompt', status: 'completed', items: [user('u'), tool('t')] },
    { id: 'goal-1', status: 'completed', items: [tool('t1'), answer('a1', 'Continuing')] },
    { id: 'goal-2', status: 'completed', items: [tool('t2'), answer('a2', 'Done')] }
  ]
  const items = getChatItems(turns)
  const merged = mergeChatDetailTurnPage(
    { id: 'goal-chat', items, itemsStartTurnIndex: 0, turnCount: 3 },
    { items: getChatItems(turns.slice(1)), startIndex: 1, totalCount: 3 },
    { startIndex: 0, endIndex: 3, totalCount: 3 }
  )
  assert.deepEqual(merged.items, items)
  assert.equal(getProviderChatTurns(items).length, 3)
})

test('goal boundaries survive live checkpoints and final-only continuation turns', () => {
  const projection = new CodexTranscriptProjection()
  let turn = { id: 'turn', status: 'inProgress', items: [] }
  compare(projection, turn)
  for (const item of [tool('t'), answer('a', 'Continuing', 'commentary'), tool('t2')]) {
    turn = update(turn, turn.items.length, item)
    compare(projection, turn)
    assert.equal(getChatItems([turn], null, options, projection)[0].startsTurn, true)
  }
  const finalOnly = getChatItems([
    { id: 'final-only', status: 'completed', items: [answer('a', 'Done', 'final_answer')] }
  ])
  assert.equal(finalOnly[0].type, 'message')
  assert.equal(finalOnly[0].startsTurn, true)
})
