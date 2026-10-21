import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeBalance,
  formatBalanceAmount,
  getBalanceUsedPercent,
  groupAccountBalances,
  selectBadgeBalance
} from './accountBalances.ts'

const balance = (modelProviderId, id, kind, amount, extra = {}) => ({
  id,
  modelProviderId,
  modelProviderName: modelProviderId === 'openrouter' ? 'OpenRouter' : 'DeepSeek',
  label: id,
  kind,
  amount,
  currency: 'USD',
  ...extra
})

const balances = [
  balance('openrouter', 'month', 'spent', 4),
  balance('openrouter', 'budget', 'spent', 40, { limit: 50 }),
  balance('deepseek', 'balance', 'remaining', 12)
]

test('badge follows the selected model provider and prefers prepaid balances', () => {
  assert.equal(selectBadgeBalance(balances, 'deepseek')?.id, 'balance')
  assert.equal(selectBadgeBalance(balances, 'openrouter')?.id, 'budget')
})

test('badge is hidden when the provider is ambiguous or reports nothing', () => {
  assert.equal(selectBadgeBalance(balances, undefined), null)
  assert.equal(selectBadgeBalance(balances, 'anthropic'), null)
  assert.equal(selectBadgeBalance(balances.slice(0, 2), undefined)?.id, 'budget')
  assert.equal(selectBadgeBalance([], 'deepseek'), null)
})

test('organization month spend is not shown; the chat cost replaces it', () => {
  const org = {
    ...balance('anthropic', 'anthropic:month', 'spent', 9.7),
    modelProviderName: 'Anthropic'
  }
  assert.equal(selectBadgeBalance([org], 'anthropic'), null)
  assert.deepEqual(
    groupAccountBalances([org, balances[2]], 'anthropic').map((group) => group.providerId),
    ['deepseek']
  )
})

test('groups put the selected provider first', () => {
  assert.deepEqual(
    groupAccountBalances(balances, 'openrouter').map((group) => [
      group.providerName,
      group.balances.length
    ]),
    [
      ['OpenRouter', 2],
      ['DeepSeek', 1]
    ]
  )
  assert.deepEqual(
    groupAccountBalances(balances, undefined).map((group) => group.providerName),
    ['DeepSeek', 'OpenRouter']
  )
})

test('describes amounts, caps and usage percentages', () => {
  assert.equal(getBalanceUsedPercent(balances[1]), 80)
  assert.equal(getBalanceUsedPercent(balances[0]), null)
  assert.equal(getBalanceUsedPercent(balances[2]), null)
  assert.match(describeBalance(balances[2]), /12.*left$/)
  assert.match(describeBalance(balances[1]), /40.*\/.*50/)
  assert.match(describeBalance(balances[0]), /4.*spent$/)
  assert.match(formatBalanceAmount(1.5, 'NOTACURRENCY'), /1\.5 NOTACURRENCY/)
  // Small spend stays visible instead of rounding to zero.
  assert.match(formatBalanceAmount(0.001375, 'USD'), /0\.0014/)
  assert.match(formatBalanceAmount(0, 'USD'), /0\.00/)
})
