import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileModelSelection, reconcileReasoningSelection } from './modelSelection.ts'

const placeholderModel = {
  id: 'opencode/big-pickle',
  label: 'Big Pickle',
  description: '',
  isDefault: true,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: 'medium'
}

const selectedModel = {
  id: 'anthropic/claude-sonnet',
  label: 'Claude Sonnet',
  description: '',
  isDefault: false,
  supportedReasoningEfforts: [
    { id: 'medium', label: 'medium', description: '', isDefault: true },
    { id: 'high', label: 'high', description: '', isDefault: false }
  ],
  defaultReasoningEffort: 'medium'
}

test('preserves an OpenCode model while its matching catalog is loading', () => {
  const selection = { model: selectedModel.id, manuallySelected: true }

  assert.deepEqual(
    reconcileModelSelection([placeholderModel], selection, 'gpt-5.6-sol', {
      activeKey: 'opencode:host',
      displayedKey: null,
      loading: true
    }),
    selection
  )
})

test('preserves OpenCode reasoning while its matching catalog is loading', () => {
  const selection = { reasoningEffort: 'high', manuallySelected: true }

  assert.deepEqual(
    reconcileReasoningSelection(placeholderModel, selection, {
      activeKey: 'opencode:host',
      displayedKey: null,
      loading: true
    }),
    selection
  )
})

test('validates stored selections once the matching catalog is ready', () => {
  const catalog = {
    activeKey: 'opencode:host',
    displayedKey: 'opencode:host',
    loading: false
  }

  assert.deepEqual(
    reconcileModelSelection(
      [placeholderModel, selectedModel],
      { model: selectedModel.id, manuallySelected: true },
      'gpt-5.6-sol',
      catalog
    ),
    { model: selectedModel.id, manuallySelected: true }
  )
  assert.deepEqual(
    reconcileReasoningSelection(
      selectedModel,
      { reasoningEffort: 'high', manuallySelected: true },
      catalog
    ),
    { reasoningEffort: 'high', manuallySelected: true }
  )
})
