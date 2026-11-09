import assert from 'node:assert/strict'
import test from 'node:test'
import { finishWorkingStepsBeforeAnswers } from './chatWorkingLifecycle.ts'
import { prepareChatItemsForRenderer } from '../main/providers/chatDetailLazy.ts'

const user = (id) => ({ type: 'message', id, role: 'user', content: 'Question' })
const working = (id, status = 'working') => ({
  type: 'working',
  id,
  status,
  startedAt: 1000,
  items: []
})
const answer = {
  type: 'message',
  id: 'server:answer',
  role: 'assistant',
  content: 'Answer',
  startsTurn: true,
  createdAt: 3000
}

test('a final answer closes the local working section even when server turn identity differs', () => {
  const items = [
    user('client:user'),
    working('client:working'),
    answer,
    user('next:user'),
    working('next:working')
  ]
  const result = prepareChatItemsForRenderer(items)
  assert.equal(result[1].status, 'worked')
  assert.equal(result[1].completedAt, 3000)
  assert.equal(result[1].items, items[1].items)
  assert.equal(result[2], answer)
  assert.equal(result[4], items[4], 'the next active turn stays active')
  assert.equal(items[1].status, 'working', 'provider snapshots stay immutable')
  assert.equal(
    finishWorkingStepsBeforeAnswers(result),
    result,
    'already finished history is reused'
  )
})

test('final-answer streaming finishes progress without waiting for turn completion', () => {
  const items = [working('work'), { ...answer, content: '', createdAt: null }]
  assert.equal(finishWorkingStepsBeforeAnswers(items)[0].status, 'worked')
})

test('answers do not finish unrelated user turns or overwrite terminal outcomes', () => {
  const items = [
    user('old'),
    working('old:work'),
    user('new'),
    ...['queued', 'stopped', 'failed', 'worked'].map((status) => working(status, status)),
    answer
  ]
  assert.equal(finishWorkingStepsBeforeAnswers(items), items)
})

test('progress and queued messages alone leave the active section intact', () => {
  const items = [working('work'), { type: 'pendingMessage', id: 'queue', content: 'Next' }]
  assert.equal(finishWorkingStepsBeforeAnswers(items), items)
})
