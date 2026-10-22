import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCopilotCustomProvider,
  getCopilotCustomProviderModels,
  getCopilotCustomProviderSessionOptions
} from './CopilotCustomProvider.ts'

test('Copilot sessions use the CLI custom provider environment', () => {
  const env = {
    COPILOT_PROVIDER_BASE_URL: ' http://127.0.0.1:11434/v1 ',
    COPILOT_PROVIDER_TYPE: 'openai',
    COPILOT_PROVIDER_WIRE_API: 'responses',
    COPILOT_PROVIDER_API_KEY: 'key',
    COPILOT_MODEL: 'local-model'
  }
  assert.deepEqual(getCopilotCustomProvider(env), {
    baseUrl: 'http://127.0.0.1:11434/v1',
    type: 'openai',
    wireApi: 'responses',
    apiKey: 'key'
  })
  assert.deepEqual(
    getCopilotCustomProviderModels(env).map((model) => [model.id, model.isDefault]),
    [['local-model', true]]
  )
  assert.equal(getCopilotCustomProviderSessionOptions('auto', env).model, 'local-model')
  assert.equal(getCopilotCustomProviderSessionOptions('chosen', env).model, 'chosen')
  assert.equal(getCopilotCustomProviderSessionOptions(undefined, env).provider.apiKey, 'key')
})

test('Copilot sessions keep GitHub routing without a custom provider', () => {
  assert.equal(getCopilotCustomProvider({ COPILOT_MODEL: 'gpt' }), undefined)
  assert.deepEqual(getCopilotCustomProviderModels({ COPILOT_MODEL: 'gpt' }), [])
  assert.deepEqual(getCopilotCustomProviderSessionOptions('gpt', {}), { model: 'gpt' })
  assert.equal(
    getCopilotCustomProvider({
      COPILOT_PROVIDER_BASE_URL: 'http://x',
      COPILOT_PROVIDER_TYPE: 'bogus'
    }).type,
    undefined
  )
})
