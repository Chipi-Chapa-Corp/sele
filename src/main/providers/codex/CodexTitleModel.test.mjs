import assert from 'node:assert/strict'
import test from 'node:test'
import { selectCodexTitleModel } from './CodexTitleModel.ts'

test('selects the affordable catalog model at its lowest supported effort', () => {
  assert.deepEqual(
    selectCodexTitleModel([
      {
        id: 'capable',
        description: 'Our most capable model for complex work.',
        supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }]
      },
      {
        id: 'quick',
        description: 'Fast and affordable model.',
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'minimal' },
          { reasoningEffort: 'low' }
        ]
      }
    ]),
    { model: 'quick', effort: 'minimal' }
  )
})

test('recognizes small model names when descriptions do not include cost', () => {
  assert.deepEqual(
    selectCodexTitleModel([
      { id: 'large', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
      { id: 'model-mini', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }
    ]),
    { model: 'model-mini', effort: 'low' }
  )
})

test('falls back to the final visible catalog model and its known default effort', () => {
  assert.deepEqual(
    selectCodexTitleModel([
      { id: 'first', defaultReasoningEffort: 'high' },
      { id: 'hidden', hidden: true, defaultReasoningEffort: 'low' },
      { id: 'last', defaultReasoningEffort: 'medium' }
    ]),
    { model: 'last', effort: 'medium' }
  )
})

test('returns null for an empty catalog', () => {
  assert.equal(selectCodexTitleModel([]), null)
})
