import assert from 'node:assert/strict'
import test from 'node:test'
import { selectCopilotTitleModel } from './CopilotTitleModel.ts'

test('selects the enabled model with the lowest billing multiplier and effort', () => {
  assert.deepEqual(
    selectCopilotTitleModel([
      {
        id: 'large',
        billing: { multiplier: 2 },
        supportedReasoningEfforts: ['high', 'low']
      },
      {
        id: 'small',
        billing: { multiplier: 0.25 },
        supportedReasoningEfforts: ['medium', 'minimal', 'low']
      }
    ]),
    { model: 'small', reasoningEffort: 'minimal' }
  )
})

test('ignores disabled and auto models when a concrete model is available', () => {
  assert.deepEqual(
    selectCopilotTitleModel([
      { id: 'auto', billing: { multiplier: 0 } },
      { id: 'disabled-mini', policy: { state: 'disabled' }, billing: { multiplier: 0.1 } },
      { id: 'enabled-model', policy: { state: 'enabled' }, billing: { multiplier: 1 } }
    ]),
    { model: 'enabled-model', reasoningEffort: null }
  )
})

test('uses a compact model hint when billing data is unavailable', () => {
  assert.deepEqual(
    selectCopilotTitleModel([{ id: 'general-model' }, { id: 'fast-mini' }, { id: 'other-model' }]),
    { model: 'fast-mini', reasoningEffort: null }
  )
})

test('uses auto when it is the only available model', () => {
  assert.deepEqual(selectCopilotTitleModel([{ id: 'auto' }]), {
    model: 'auto',
    reasoningEffort: null
  })
})

test('returns null when no model is available', () => {
  assert.equal(
    selectCopilotTitleModel([
      { id: 'disabled', policy: { state: 'disabled' } },
      { id: 'not-enabled', policy: { state: 'unconfigured' } }
    ]),
    null
  )
})
