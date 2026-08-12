import assert from 'node:assert/strict'
import test from 'node:test'
import { mapClaudeModel, mapClaudeModels } from './ClaudeModels.ts'

test('uses the resolved Claude generation in model labels', () => {
  const model = mapClaudeModel(
    {
      value: 'opus',
      resolvedModel: 'claude-opus-4-8',
      displayName: 'Opus',
      description: 'Opus 4.8 · Best for everyday, complex tasks',
      supportedEffortLevels: ['low', 'high'],
      supportsFastMode: true
    },
    1
  )

  assert.equal(model.label, 'Claude Opus 4.8')
  assert.equal(model.description, 'Best for everyday, complex tasks')
  assert.equal(model.isDefault, false)
  assert.equal(model.supportedServiceTiers?.[0]?.id, 'fast')
})

test('shows the resolved model for the default alias', () => {
  const model = mapClaudeModel(
    {
      value: 'default',
      resolvedModel: 'claude-sonnet-5',
      displayName: 'Default (recommended)',
      description: 'Sonnet 5 · Efficient for routine tasks',
      supportedEffortLevels: ['medium', 'high']
    },
    0
  )

  assert.equal(model.label, 'Claude Sonnet 5')
  assert.equal(
    model.description,
    "Uses Claude Code's recommended model · Efficient for routine tasks"
  )
  assert.equal(model.isDefault, true)
})

test('falls back to the resolved model id when the description has no model prefix', () => {
  const model = mapClaudeModel(
    {
      value: 'haiku',
      resolvedModel: 'claude-haiku-4-5-20251001',
      displayName: 'Haiku',
      description: 'Fast responses'
    },
    1
  )

  assert.equal(model.label, 'Claude Haiku 4.5')
  assert.equal(model.description, 'Fast responses')
})

test('collapses an alias that resolves to the recommended model', () => {
  const models = mapClaudeModels([
    {
      value: 'default',
      resolvedModel: 'claude-sonnet-5',
      displayName: 'Default (recommended)',
      description: 'Sonnet 5 · Efficient for routine tasks'
    },
    {
      value: 'sonnet',
      resolvedModel: 'claude-sonnet-5',
      displayName: 'Sonnet',
      description: 'Sonnet 5 · Efficient for routine tasks'
    },
    {
      value: 'opus',
      resolvedModel: 'claude-opus-5',
      displayName: 'Opus',
      description: 'Opus 5 · Most capable for complex tasks'
    }
  ])

  assert.deepEqual(
    models.map((model) => [model.id, model.label, model.isDefault]),
    [
      ['default', 'Claude Sonnet 5', true],
      ['opus', 'Claude Opus 5', false]
    ]
  )
})

test('retains the family alias when Claude recommends a different model', () => {
  const models = mapClaudeModels([
    {
      value: 'default',
      resolvedModel: 'claude-fable-5',
      displayName: 'Default (recommended)',
      description: 'Fable 5 · Recommended model'
    },
    {
      value: 'sonnet',
      resolvedModel: 'claude-sonnet-5',
      displayName: 'Sonnet',
      description: 'Sonnet 5 · Efficient for routine tasks'
    }
  ])

  assert.deepEqual(
    models.map((model) => model.id),
    ['default', 'sonnet']
  )
})
