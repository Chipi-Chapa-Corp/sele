import assert from 'node:assert/strict'
import test from 'node:test'
import { mapClaudeModels } from './ClaudeModels.ts'

test('keeps Auto separate from the explicit model it currently resolves to', () => {
  const models = mapClaudeModels([
    {
      value: 'default',
      resolvedModel: 'claude-opus-5[1m]',
      displayName: 'Default (recommended)',
      description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
      supportedEffortLevels: ['low', 'high'],
      supportsFastMode: true
    },
    {
      value: 'opus[1m]',
      resolvedModel: 'claude-opus-5[1m]',
      displayName: 'Opus (1M context)',
      description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
      supportedEffortLevels: ['low', 'high'],
      supportsFastMode: true
    },
    {
      value: 'sonnet',
      resolvedModel: 'claude-sonnet-5',
      displayName: 'Sonnet',
      description: 'Sonnet 5 · Efficient for routine tasks',
      supportedEffortLevels: ['low', 'high']
    }
  ])

  assert.deepEqual(
    models.map(({ id, label }) => ({ id, label })),
    [
      { id: 'default', label: 'Auto' },
      { id: 'opus[1m]', label: 'Opus 5 with 1M context' },
      { id: 'sonnet', label: 'Sonnet 5' }
    ]
  )
  assert.equal(models[0].usageScope, undefined)
  assert.equal(
    models[0].description,
    "Use the model configured in Claude Code, or Claude's account default."
  )
  assert.equal(models[1].usageScope, 'opus')
})
