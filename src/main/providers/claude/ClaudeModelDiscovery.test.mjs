import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverClaudeModels } from './ClaudeModelDiscovery.ts'

test('uses the fresh reinitialize catalog instead of the stale supportedModels snapshot', async () => {
  let supportedModelsCalls = 0
  const freshModels = [{ value: 'fresh' }]
  const models = await discoverClaudeModels(
    {
      supportedModels: async () => {
        supportedModelsCalls += 1
        return [{ value: 'stale' }]
      },
      reinitialize: async () => ({ models: freshModels })
    },
    true
  )

  assert.equal(supportedModelsCalls, 0)
  assert.equal(models, freshModels)
})

test('uses the initial supportedModels catalog without an extra initialization', async () => {
  let reinitializeCalls = 0
  const initialModels = [{ value: 'initial' }]
  const models = await discoverClaudeModels(
    {
      supportedModels: async () => initialModels,
      reinitialize: async () => {
        reinitializeCalls += 1
        return { models: [] }
      }
    },
    false
  )

  assert.equal(reinitializeCalls, 0)
  assert.equal(models, initialModels)
})
