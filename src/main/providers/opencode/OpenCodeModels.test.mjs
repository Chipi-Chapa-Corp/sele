import assert from 'node:assert/strict'
import test from 'node:test'
import { mapOpenCodeModels } from './OpenCodeModels.ts'

const model = (id, name) => ({ id, name, limit: { context: 200_000 } })

test('names the provider when several providers serve the same model', () => {
  const models = mapOpenCodeModels(
    [
      {
        id: 'opencode',
        name: 'OpenCode Zen',
        models: {
          'claude-opus-5-5': model('claude-opus-5-5', 'Claude Opus 5.5'),
          'big-pickle': model('big-pickle', 'Big Pickle')
        }
      },
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: { 'claude-opus-5-5': model('claude-opus-5-5', 'Claude Opus 5.5') }
      }
    ],
    { anthropic: 'claude-opus-5-5' }
  )

  assert.deepEqual(
    models.map(({ id, label, description, isDefault }) => ({ id, label, description, isDefault })),
    [
      {
        id: 'opencode/claude-opus-5-5',
        label: 'Claude Opus 5.5 (OpenCode Zen)',
        description: 'OpenCode Zen · 200K context window.',
        isDefault: false
      },
      {
        id: 'opencode/big-pickle',
        label: 'Big Pickle',
        description: 'OpenCode Zen · 200K context window.',
        isDefault: false
      },
      {
        id: 'anthropic/claude-opus-5-5',
        label: 'Claude Opus 5.5 (Anthropic)',
        description: 'Anthropic · 200K context window.',
        isDefault: true
      }
    ]
  )
  assert.deepEqual(models[0].modelProvider, { id: 'opencode', name: 'OpenCode Zen' })
  assert.deepEqual(models[2].modelProvider, { id: 'anthropic', name: 'Anthropic' })
})
