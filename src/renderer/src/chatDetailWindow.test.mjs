import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshRetainedChatDetailTurnWindow } from './chatDetailWindow.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const user = (id) => ({ type: 'message', id, role: 'user', content: id })
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const detail = (items, extra = {}) => ({
  id: 'claude-session',
  revision: 1,
  status: 'active',
  items,
  itemsStartTurnIndex: 0,
  turnCount: 1,
  ...extra
})

test('a paused viewport replaces the placeholder with live activity and the completed answer', () => {
  const prompt = user('prompt')
  const placeholder = { type: 'working', id: 'working', status: 'working', items: [] }
  const current = detail([prompt, placeholder])
  const tool = { type: 'tool', id: 'read', status: 'completed' }
  const streaming = detail([prompt, { ...placeholder, items: [tool] }], { revision: 2 })
  const live = refreshRetainedChatDetailTurnWindow(current, streaming)
  assert.deepEqual(live.items, streaming.items)

  const completed = detail(
    [
      prompt,
      { ...placeholder, status: 'worked', items: [tool] },
      { type: 'message', id: 'answer', role: 'assistant', content: 'Finished' }
    ],
    { revision: 3, status: null }
  )
  const result = refreshRetainedChatDetailTurnWindow(live, completed)
  assert.deepEqual(result.items, completed.items)
  assert.equal(result.status, null)
  assert.equal(result.revision, 3)
})

test('refreshes overlapping turns while keeping older loaded turns and excluding newer turns', () => {
  const older = user('older')
  const prompt = user('prompt')
  const current = detail([older, prompt], { itemsStartTurnIndex: 4, turnCount: 6 })
  const answer = { type: 'message', id: 'answer', role: 'assistant', content: 'Finished' }
  const snapshot = detail([prompt, answer, user('new-turn')], {
    itemsStartTurnIndex: 5,
    turnCount: 7
  })
  const result = refreshRetainedChatDetailTurnWindow(current, snapshot)
  assert.deepEqual(result.items, [older, prompt, answer])
  assert.equal(result.itemsStartTurnIndex, 4)
  assert.equal(result.turnCount, 7)
})

test('keeps a disjoint history window when the latest snapshot arrives', () => {
  const current = detail([user('old')], { turnCount: 20 })
  const snapshot = detail([user('latest')], { itemsStartTurnIndex: 19, turnCount: 20 })
  const result = refreshRetainedChatDetailTurnWindow(current, snapshot)
  assert.deepEqual(result.items, current.items)
  assert.equal(result.itemsStartTurnIndex, 0)
})

test('an empty viewport accepts the first turn even when auto-scroll is paused', () => {
  const current = detail([], { turnCount: 0 })
  const snapshot = detail([user('prompt')])
  assert.equal(refreshRetainedChatDetailTurnWindow(current, snapshot), snapshot)
})
