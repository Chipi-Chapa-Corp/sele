import assert from 'node:assert/strict'
import test from 'node:test'
import { TokenUsageAccumulator } from './tokenUsageAccumulator.ts'
import { addTokenUsage, emptyTokenUsage } from '../../shared/tokenUsage.ts'

test('incremental accounting matches a full fold after replacements and removals', () => {
  const total = new TokenUsageAccumulator()
  const rows = new Map()
  const variants = [
    { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2 },
    {
      inputTokens: 2,
      cachedInputTokens: 5,
      outputTokens: 3,
      cost: { input: 1, cachedInput: 2, output: 3, total: 6 }
    },
    {
      inputTokens: 0,
      cachedInputTokens: 4,
      outputTokens: 0,
      cost: { input: 0, cachedInput: null, output: 0, total: null }
    },
    {
      inputTokens: 8,
      cachedInputTokens: 0,
      outputTokens: 1,
      costUsesFallback: true,
      cost: { input: 2, cachedInput: 0, output: 1, total: 3 }
    }
  ]
  const verify = () =>
    assert.deepEqual(
      total.snapshot(),
      rows.size ? [...rows.values()].reduce(addTokenUsage, emptyTokenUsage()) : null
    )
  for (let index = 0; index < 200; index++) {
    const id = index % 17
    if (rows.has(id)) total.add(rows.get(id), -1)
    if (index % 3 === 0) rows.delete(id)
    else {
      rows.set(id, variants[index % variants.length])
      total.add(rows.get(id))
    }
    verify()
  }
  for (const row of rows.values()) total.add(row, -1)
  assert.equal(total.snapshot(), null)
})
