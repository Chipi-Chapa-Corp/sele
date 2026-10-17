import assert from 'node:assert/strict'
import test from 'node:test'
import { renderOpenCodeChatItems } from './OpenCodeItemRenderers.ts'
import { unloadWorkingItemPayload } from '../workingStepLazy.ts'

test('reasoning keeps its own lifecycle and identity through lazy payloads', () => {
  for (const [end, completed, expected] of [
    [undefined, undefined, 'inProgress'],
    [2000, undefined, 'completed'],
    [undefined, 3000, 'completed']
  ]) {
    const items = renderOpenCodeChatItems(
      [
        {
          info: { id: 'assistant', role: 'assistant', time: { created: 1000, completed } },
          parts: [
            { type: 'reasoning', id: 'reasoning', text: ' A thought ', time: { start: 1000, end } },
            { type: 'retry', id: 'retry', attempt: 1, error: { message: 'Try again' } }
          ]
        }
      ],
      { active: true, stopped: false }
    )
    const working = items.find((item) => item.type === 'working')
    assert.equal(working.status, 'working')
    const reasoning = working.items[0]
    assert.equal(reasoning.kind, 'reasoning')
    assert.equal(reasoning.status, expected)
    const unloaded = unloadWorkingItemPayload(reasoning)
    assert.equal(unloaded.kind, 'reasoning')
    assert.equal(unloaded.status, expected)
    assert.equal(unloaded.contentLoaded, false)
    assert.equal(working.items[1].kind, undefined, 'retry text stays an ordinary progress message')
  }
})

test('aborted turns render as stopped without an error message', () => {
  const user = (id, text) => ({
    info: { id, role: 'user', time: { created: 1000 } },
    parts: [{ type: 'text', id: `${id}:text`, text }]
  })
  const items = renderOpenCodeChatItems(
    [
      user('user-1', 'First'),
      {
        info: {
          id: 'assistant',
          role: 'assistant',
          time: { created: 1100 },
          error: { name: 'MessageAbortedError', data: { message: 'The operation was aborted.' } }
        },
        parts: [{ type: 'text', id: 'partial', text: 'Partial answer' }]
      },
      user('user-2', 'Second')
    ],
    { active: false, stopped: false }
  )
  const working = items.find((item) => item.type === 'working')
  assert.equal(working?.status, 'stopped')
  assert.equal(working?.failureMessage, undefined)
  assert.equal(JSON.stringify(items).includes('The operation was aborted.'), false)
})
