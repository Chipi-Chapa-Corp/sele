import assert from 'node:assert/strict'
import test from 'node:test'
import { getProviderChatTurns, unloadChatItemsOutsideTurnRange } from './chatTurns.ts'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const userMessage = (id) => ({ type: 'message', id, role: 'user', content: id })
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const assistantMessage = (id) => ({ type: 'message', id, role: 'assistant', content: id })

test('groups a user message, working sections, and assistant response into one turn', () => {
  const firstUser = userMessage('user-1')
  const firstWorking = { type: 'working', id: 'working-1', status: 'worked', items: [] }
  const firstAssistant = assistantMessage('assistant-1')
  const secondUser = userMessage('user-2')
  const secondAssistant = assistantMessage('assistant-2')

  assert.deepEqual(
    getProviderChatTurns([firstUser, firstWorking, firstAssistant, secondUser, secondAssistant]),
    [
      { id: firstUser.id, items: [firstUser, firstWorking, firstAssistant] },
      { id: secondUser.id, items: [secondUser, secondAssistant] }
    ]
  )
})

test('unloads message bodies outside the retained turn range', () => {
  const firstUser = userMessage('user-1')
  const firstAssistant = {
    ...assistantMessage('assistant-1'),
    attachments: [{ kind: 'file', name: 'large.txt' }]
  }
  const secondUser = userMessage('user-2')
  const secondAssistant = assistantMessage('assistant-2')

  const result = unloadChatItemsOutsideTurnRange(
    [firstUser, firstAssistant, secondUser, secondAssistant],
    1,
    2
  )

  assert.deepEqual(result.slice(0, 2), [
    { ...firstUser, content: '', attachments: undefined, contentLoaded: false },
    { ...firstAssistant, content: '', attachments: undefined, contentLoaded: false }
  ])
  assert.strictEqual(result[2], secondUser)
  assert.strictEqual(result[3], secondAssistant)
})

test('unloads working details outside the retained turn range', () => {
  const firstUser = userMessage('user-1')
  const firstWorking = {
    type: 'working',
    id: 'working-1',
    status: 'worked',
    items: [{ type: 'message', id: 'thought-1', content: 'Large historical details' }]
  }
  const secondUser = userMessage('user-2')
  const secondWorking = {
    type: 'working',
    id: 'working-2',
    status: 'working',
    items: [{ type: 'message', id: 'thought-2', content: 'Visible details' }]
  }

  const result = unloadChatItemsOutsideTurnRange(
    [firstUser, firstWorking, secondUser, secondWorking],
    1,
    2
  )

  assert.deepEqual(result[1], {
    ...firstWorking,
    items: [],
    itemsLoaded: false,
    itemCount: 1
  })
  assert.strictEqual(result[3], secondWorking)
})
