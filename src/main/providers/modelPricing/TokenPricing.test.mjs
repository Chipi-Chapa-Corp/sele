import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeTokenUsage,
  addTokenUsage,
  formatTurnTokenUsage,
  formatUsageDollars,
  extrapolateTokenCost,
  formatTokenCostEstimateTitle
} from '../../../shared/tokenUsage.ts'
import {
  estimateModelCost,
  estimateAggregateTokenRate,
  applyFallbackModelPricing,
  differenceModelUsage,
  priceModelUsage,
  copilotPriceRates
} from './TokenPricing.ts'

const usage = (input, cache, output) => normalizeTokenUsage(input, cache, output)
const rates = {
  input: 2,
  cacheRead: 0.2,
  cacheWrite: 2.5,
  output: 10,
  tiers: [{ input: 4, cacheRead: 0.4, cacheWrite: 5, output: 15, contextAbove: 272000 }]
}

test('legacy usage uses its recorded categories and flags an assumed model without changing native costs', () => {
  const model = { modelId: 'fallback', rates, usage: usage(1, 1, 1), totalUSD: 99 }
  const historical = usage(1000000, 9000000, 100000)
  const priced = applyFallbackModelPricing(historical, model)
  assert.deepEqual(priced.cost, { input: 2, cachedInput: 1.8, output: 1, total: 4.8 })
  assert.equal(priced.costUsesFallback, true)
  assert.equal(addTokenUsage(priced, priceModelUsage([model])).costUsesFallback, true)
  const native = { ...historical, cost: { input: 3, cachedInput: 2, output: 1, total: 6 } }
  assert.equal(applyFallbackModelPricing(native, model), native)
  assert.equal(applyFallbackModelPricing(historical, undefined), historical)
})

test('aggregate statistics assume 95% cache, 4% output and 1% input across saved model prices', () => {
  const sample = estimateAggregateTokenRate([
    { modelId: 'one', rates, usage: usage(1000000, 0, 0), totalUSD: 99 },
    { modelId: 'two', rates, contextTokens: 300000, usage: usage(0, 0, 3000000) },
    { modelId: 'unknown', usage: usage(9000000, 0, 0) }
  ])
  // Base: .01×2 + .95×.2 + .04×10 = .61; long context: 1.02.
  assert.equal(sample.tokens, 4000000)
  assert.ok(Math.abs(sample.usdPerMillionTokens - 0.9175) < 1e-10)
  assert.ok(Math.abs(extrapolateTokenCost('1000000000', sample).costUSD - 917.5) < 1e-10)
  assert.match(
    formatTokenCostEstimateTitle(917.5, sample, ''),
    /95% cached input, 4% output, and 1% input/
  )
  assert.equal(extrapolateTokenCost('0', null).costUSD, 0)
  for (const value of [null, '-1', '1.5', '9007199254740992'])
    assert.equal(extrapolateTokenCost(value, sample).costUSD, null)
  assert.equal(extrapolateTokenCost('100', null).costUSD, null)
  assert.equal(
    estimateAggregateTokenRate([
      { modelId: 'no-cache-rate', rates: { input: 2, output: 10 }, usage: usage(1, 0, 0) }
    ]),
    null
  )
})

test('prices disjoint categories and context tiers without counting cache writes twice', () => {
  const model = {
    modelId: 'model',
    usage: usage(1000000, 1000000, 1000000),
    cacheWriteTokens: 200000,
    rates
  }
  assert.deepEqual(estimateModelCost(model), {
    input: 2.1,
    cachedInput: 0.2,
    output: 10,
    total: 12.3
  })
  assert.deepEqual(estimateModelCost({ ...model, contextTokens: 272001 }), {
    input: 4.2,
    cachedInput: 0.4,
    output: 15,
    total: 19.6
  })
  assert.equal(estimateModelCost({ ...model, contextTokens: 272000 }).total, 12.3)
})

test('keeps native totals while apportioning categories using relative model rates', () => {
  const cost = estimateModelCost({
    modelId: 'claude',
    usage: usage(1000000, 1000000, 1000000),
    rates: { input: 3, cacheRead: 0.3, output: 15 },
    totalUSD: 36.6
  })
  assert.equal(cost.total, 36.6)
  assert.ok(Math.abs(cost.input - 6) < 1e-10)
  assert.ok(Math.abs(cost.cachedInput - 0.6) < 1e-10)
  assert.ok(Math.abs(cost.output - 30) < 1e-10)
  assert.deepEqual(
    estimateModelCost({ modelId: 'unknown', usage: usage(10, 20, 30), totalUSD: 0 }),
    { input: 0, cachedInput: 0, output: 0, total: 0 }
  )
  assert.equal(
    estimateModelCost({ modelId: 'unknown', usage: usage(10, 20, 30), totalUSD: 1 }).total,
    1
  )
})

test('differences native model counters before pricing and preserves model-specific rates', () => {
  const before = [{ modelId: 'a', usage: usage(100, 50, 10), totalUSD: 1, rates }]
  const after = [
    { ...before[0], usage: usage(150, 60, 20), totalUSD: 1.5 },
    { modelId: 'b', usage: usage(200, 10, 30), totalUSD: 2, rates }
  ]
  const delta = differenceModelUsage(after, before)
  assert.deepEqual(delta[0].usage, usage(50, 10, 10))
  assert.equal(delta[0].totalUSD, 0.5)
  assert.equal(delta[1].totalUSD, 2)
  assert.equal(priceModelUsage(delta).cost.total, 2.5)
  assert.equal(priceModelUsage(differenceModelUsage(after, after)).cost.total, 0)
})

test('converts Copilot credit prices to dollars and does not confuse multipliers with USD', () => {
  assert.deepEqual(
    copilotPriceRates({
      batchSize: 1000000,
      inputPrice: 200,
      outputPrice: 1000,
      cacheReadPrice: 20,
      cacheWritePrice: 250
    }),
    { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: undefined }
  )
  assert.equal(copilotPriceRates({ inputPrice: 1, outputPrice: 2 }), undefined)
  assert.equal(copilotPriceRates({ batchSize: Infinity, inputPrice: 1, outputPrice: 2 }), undefined)
})

test('unknown prices propagate through totals and small nonzero costs remain visible', () => {
  const known = priceModelUsage([{ modelId: 'known', usage: usage(100, 0, 10), rates }])
  assert.ok(known.cost.total > 0)
  assert.equal(addTokenUsage(known, usage(10, 0, 0)).cost.total, null)
  assert.equal(formatTurnTokenUsage(known), '0.0003$')
  assert.equal(formatUsageDollars(0), '0.00')
  assert.equal(formatUsageDollars(0.000000005), '0.000000005')
  assert.equal(formatUsageDollars(null), '—')
  assert.equal(
    estimateModelCost({
      modelId: 'missing-write-rate',
      usage: usage(100, 0, 10),
      cacheWriteTokens: 20,
      rates: { input: 2, output: 10 }
    }).total,
    null
  )
})
