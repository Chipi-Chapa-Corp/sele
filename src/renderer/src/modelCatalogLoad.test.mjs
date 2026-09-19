import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveProviderModelCatalogFailure,
  resolveProviderModelCatalogSuccess
} from './modelCatalogLoad.ts'

const cachedModels = [{ id: 'cached' }]
const fallbackModels = [{ id: 'fallback' }]
const freshModels = [{ id: 'fresh' }]

test('keeps the last successful model catalog while exposing refresh errors', () => {
  assert.deepEqual(
    resolveProviderModelCatalogFailure(cachedModels, fallbackModels, 'Discovery failed'),
    { models: cachedModels, error: 'Discovery failed', cache: false }
  )
})

test('uses fallback models on an initial failure without caching them as discovery', () => {
  assert.deepEqual(
    resolveProviderModelCatalogFailure(undefined, fallbackModels, 'Discovery failed'),
    { models: fallbackModels, error: 'Discovery failed', cache: false }
  )
})

test('a successful retry replaces the catalog and clears the prior error', () => {
  assert.deepEqual(resolveProviderModelCatalogSuccess(freshModels, fallbackModels), {
    models: freshModels,
    error: null,
    cache: true
  })
})
