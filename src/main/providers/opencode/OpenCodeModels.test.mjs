import assert from 'node:assert/strict'
import test from 'node:test'
import { mapOpenCodeModels, parseOpenCodeModelId } from './OpenCodeModels.ts'

test('maps OpenCode provider models and reasoning variants', () => {
  const models = mapOpenCodeModels(
    [
      {
        id: 'anthropic',
        name: 'Anthropic',
        models: {
          'claude-sonnet': {
            id: 'claude-sonnet',
            name: 'Claude Sonnet',
            status: 'active',
            limit: { context: 200_000, output: 64_000 },
            variants: { low: {}, high: {} },
            request: { variant: 'high' }
          }
        }
      },
      {
        id: 'openai',
        name: 'OpenAI',
        models: {
          gpt: {
            id: 'gpt',
            name: 'GPT',
            status: 'deprecated',
            limit: { context: 1_000_000, output: 100_000 }
          }
        }
      }
    ],
    { anthropic: 'claude-sonnet' },
    'openai/gpt'
  )

  assert.deepEqual(
    models.map((model) => ({
      id: model.id,
      label: model.label,
      description: model.description,
      isDefault: model.isDefault,
      variants: model.supportedReasoningEfforts.map((variant) => variant.id),
      defaultVariant: model.defaultReasoningEffort
    })),
    [
      {
        id: 'anthropic/claude-sonnet',
        label: 'Claude Sonnet · Anthropic',
        description: '200K context window.',
        isDefault: false,
        variants: ['low', 'high'],
        defaultVariant: 'high'
      },
      {
        id: 'openai/gpt',
        label: 'GPT · OpenAI',
        description: '1M context window. Deprecated.',
        isDefault: true,
        variants: [],
        defaultVariant: 'medium'
      }
    ]
  )
})

test('uses OpenCode provider defaults and parses compound model names', () => {
  const models = mapOpenCodeModels(
    [
      {
        id: 'provider',
        name: 'Provider',
        models: {
          'family/model': {
            id: 'family/model',
            name: 'Family Model',
            status: 'active',
            limit: { context: 128_000, output: 32_000 }
          }
        }
      }
    ],
    { provider: 'family/model' }
  )

  assert.equal(models[0]?.isDefault, true)
  assert.deepEqual(parseOpenCodeModelId('provider/family/model'), {
    providerID: 'provider',
    modelID: 'family/model'
  })
  assert.throws(() => parseOpenCodeModelId('missing-provider'), /provider\/model/)
})
