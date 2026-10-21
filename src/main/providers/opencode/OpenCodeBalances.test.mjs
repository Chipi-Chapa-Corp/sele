import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchOpenCodeBalance,
  getOpenCodeEnvironmentApiKeys,
  OpenCodeBalanceCache,
  OpenCodeBalanceUnavailableError,
  selectOpenCodeBalanceKeys,
  verifyOpenCodeAdminKey
} from './OpenCodeBalances.ts'
import { extractOpenCodeApiKeys } from './OpenCodeUsage.ts'

const now = Date.parse('2026-10-21T12:00:00.000Z')
const monthStart = '2026-10-01T00:00:00.000Z'
const nextMonth = Date.parse('2026-11-01T00:00:00.000Z')

const respond = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload
})

const recordingFetch = (handler) => {
  const requests = []
  const fetchFn = async (url, options) => {
    requests.push({ url: String(url), headers: options.headers })
    return handler(String(url), options)
  }
  return { requests, fetchFn }
}

test('collects API keys from every saved provider and skips OAuth entries', () => {
  assert.deepEqual(
    extractOpenCodeApiKeys({
      openrouter: { type: 'api', key: ' sk-or ' },
      anthropic: { type: 'oauth', access: 'token' },
      deepseek: { type: 'api', key: '' },
      broken: null
    }),
    { openrouter: 'sk-or' }
  )
  assert.deepEqual(extractOpenCodeApiKeys(null), {})
})

test('environment keys cover providers with unambiguous variables only', () => {
  assert.deepEqual(
    getOpenCodeEnvironmentApiKeys({
      DEEPSEEK_API_KEY: 'sk-ds',
      MOONSHOT_API_KEY: 'sk-moon',
      OPENAI_API_KEY: '  ',
      UNRELATED: 'x'
    }),
    { deepseek: 'sk-ds' }
  )
})

test('admin keys take precedence and unsupported providers are skipped', () => {
  assert.deepEqual(
    selectOpenCodeBalanceKeys(
      { anthropic: 'sk-ant-api', deepseek: 'sk-ds', groq: 'gsk' },
      { anthropic: 'sk-ant-admin01' }
    ),
    {
      deepseek: { key: 'sk-ds', admin: false },
      anthropic: { key: 'sk-ant-admin01', admin: true }
    }
  )
})

test('reads OpenRouter key limits, budgets and monthly usage with the inference key', async () => {
  const { requests, fetchFn } = recordingFetch(() =>
    respond({
      data: {
        limit: 20,
        limit_remaining: 5,
        limit_reset: 'monthly',
        usage_monthly: 12.5,
        effective_budget: {
          scope: 'member',
          limit_usd: 50,
          spend_usd: 40,
          reset_interval: 'weekly',
          resets_at: '2026-10-26T00:00:00.000Z'
        }
      }
    })
  )
  const balances = await fetchOpenCodeBalance(
    'openrouter',
    { key: 'sk-or', admin: false },
    fetchFn,
    now
  )
  assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/key')
  assert.equal(requests[0].headers.authorization, 'Bearer sk-or')
  assert.deepEqual(
    balances.map((balance) => [balance.id, balance.kind, balance.amount, balance.limit ?? null]),
    [
      ['openrouter:key-limit', 'spent', 15, 20],
      ['openrouter:budget', 'spent', 40, 50],
      ['openrouter:month', 'spent', 12.5, null]
    ]
  )
  assert.equal(balances[1].resetsAt, Date.parse('2026-10-26T00:00:00.000Z'))
  assert.equal(balances[2].resetsAt, nextMonth)
  assert.ok(balances.every((balance) => balance.modelProviderId === 'openrouter'))
})

test('reads OpenRouter account credits with a management key', async () => {
  const { requests, fetchFn } = recordingFetch(() =>
    respond({ data: { total_credits: 100, total_usage: 37.25 } })
  )
  const [balance] = await fetchOpenCodeBalance(
    'openrouter',
    { key: 'mgmt', admin: true },
    fetchFn,
    now
  )
  assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/credits')
  assert.deepEqual([balance.kind, balance.amount, balance.currency], ['remaining', 62.75, 'USD'])
})

test('reads DeepSeek balances per currency', async () => {
  const { requests, fetchFn } = recordingFetch(() =>
    respond({
      is_available: true,
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '110.00',
          granted_balance: '10.00',
          topped_up_balance: '100.00'
        },
        { currency: 'USD', total_balance: '2.50' }
      ]
    })
  )
  const balances = await fetchOpenCodeBalance(
    'deepseek',
    { key: 'sk-ds', admin: false },
    fetchFn,
    now
  )
  assert.equal(requests[0].url, 'https://api.deepseek.com/user/balance')
  assert.deepEqual(
    balances.map((balance) => [balance.currency, balance.amount, balance.kind]),
    [
      ['CNY', 110, 'remaining'],
      ['USD', 2.5, 'remaining']
    ]
  )
})

test('reads Moonshot and SiliconFlow balances from the regional host', async () => {
  const { requests, fetchFn } = recordingFetch((url) =>
    url.includes('moonshot')
      ? respond({
          code: 0,
          data: { available_balance: 49.5, voucher_balance: 46, cash_balance: 3.5 }
        })
      : respond({
          code: 20000,
          data: { balance: '0.88', chargeBalance: '88.00', totalBalance: '88.88' }
        })
  )
  const [moonshot] = await fetchOpenCodeBalance(
    'moonshotai-cn',
    { key: 'k', admin: false },
    fetchFn,
    now
  )
  const [silicon] = await fetchOpenCodeBalance(
    'siliconflow',
    { key: 'k', admin: false },
    fetchFn,
    now
  )
  assert.equal(requests[0].url, 'https://api.moonshot.cn/v1/users/me/balance')
  assert.equal(requests[1].url, 'https://api.siliconflow.com/v1/user/info')
  assert.deepEqual([moonshot.amount, moonshot.currency], [49.5, 'CNY'])
  assert.deepEqual([silicon.amount, silicon.currency], [88.88, 'USD'])
})

test('sums Anthropic month-to-date cost in cents across pages', async () => {
  const { requests, fetchFn } = recordingFetch((url) =>
    url.includes('page=')
      ? respond({
          data: [{ results: [{ amount: '50', currency: 'USD' }] }],
          has_more: false,
          next_page: null
        })
      : respond({
          data: [{ results: [{ amount: '123.45', currency: 'USD' }] }, { results: [] }],
          has_more: true,
          next_page: 'page_2'
        })
  )
  const [balance] = await fetchOpenCodeBalance(
    'anthropic',
    { key: 'sk-ant-admin01', admin: true },
    fetchFn,
    now
  )
  const first = new URL(requests[0].url)
  assert.equal(
    first.origin + first.pathname,
    'https://api.anthropic.com/v1/organizations/cost_report'
  )
  assert.equal(first.searchParams.get('starting_at'), monthStart)
  assert.equal(requests[0].headers['x-api-key'], 'sk-ant-admin01')
  assert.equal(requests[0].headers['anthropic-version'], '2023-06-01')
  assert.equal(new URL(requests[1].url).searchParams.get('page'), 'page_2')
  assert.equal(balance.kind, 'spent')
  assert.ok(Math.abs(balance.amount - 1.7345) < 1e-9)
  assert.equal(balance.resetsAt, nextMonth)
})

test('sums OpenAI organization costs from the start of the month', async () => {
  const { requests, fetchFn } = recordingFetch(() =>
    respond({
      data: [
        {
          results: [
            { amount: { value: 0.25, currency: 'usd' } },
            { amount: { value: 1.5, currency: 'usd' } }
          ]
        }
      ],
      has_more: false,
      next_page: null
    })
  )
  const [balance] = await fetchOpenCodeBalance(
    'openai',
    { key: 'sk-admin-x', admin: true },
    fetchFn,
    now
  )
  const url = new URL(requests[0].url)
  assert.equal(url.origin + url.pathname, 'https://api.openai.com/v1/organization/costs')
  assert.equal(url.searchParams.get('start_time'), String(Date.parse(monthStart) / 1_000))
  assert.equal(requests[0].headers.authorization, 'Bearer sk-admin-x')
  assert.deepEqual([balance.amount, balance.currency], [1.75, 'USD'])
})

test('inference keys without billing access are treated as unavailable, not errors', async () => {
  for (const status of [401, 403, 404]) {
    await assert.rejects(
      fetchOpenCodeBalance(
        'anthropic',
        { key: 'sk-ant-api', admin: false },
        async () => respond({}, status),
        now
      ),
      OpenCodeBalanceUnavailableError
    )
  }
})

test('rejected admin keys and broken balance responses stay visible', async () => {
  await assert.rejects(
    fetchOpenCodeBalance(
      'openai',
      { key: 'sk-admin', admin: true },
      async () => respond({}, 401),
      now
    ),
    (error) => !(error instanceof OpenCodeBalanceUnavailableError) && /rejected/.test(error.message)
  )
  await assert.rejects(
    fetchOpenCodeBalance(
      'deepseek',
      { key: 'sk-ds', admin: false },
      async () => respond({}, 401),
      now
    ),
    (error) =>
      !(error instanceof OpenCodeBalanceUnavailableError) && /DeepSeek rejected/.test(error.message)
  )
  await assert.rejects(
    fetchOpenCodeBalance(
      'deepseek',
      { key: 'sk-ds', admin: false },
      async () => respond({ nope: true }),
      now
    ),
    /invalid balance response/
  )
})

test('errors never include the key', async () => {
  const key = 'sk-secret-value'
  for (const fetchFn of [
    async () => {
      throw new Error(`connect failed for ${key}`)
    },
    async () => respond({}, 500)
  ]) {
    await assert.rejects(
      fetchOpenCodeBalance('deepseek', { key, admin: false }, fetchFn, now),
      (error) => !error.message.includes(key)
    )
  }
})

test('cache reuses fresh reads, hides unavailable providers and reports real failures', async () => {
  let clock = now
  let calls = 0
  const fetchFn = async (url) => {
    calls += 1
    if (url.includes('deepseek'))
      return respond({ balance_infos: [{ currency: 'USD', total_balance: '3' }] })
    if (url.includes('anthropic')) return respond({}, 403)
    return respond({}, 503)
  }
  const cache = new OpenCodeBalanceCache(fetchFn, () => clock)
  const keys = {
    deepseek: { key: 'sk-ds', admin: false },
    anthropic: { key: 'sk-ant-api', admin: false },
    openrouter: { key: 'sk-or', admin: false }
  }
  const first = await cache.get(keys)
  assert.deepEqual(
    first.balances.map((balance) => balance.id),
    ['deepseek:USD']
  )
  assert.deepEqual(first.errors, ['OpenRouter balance request failed with status 503.'])
  assert.equal(calls, 3)

  clock += 30_000
  await cache.get(keys)
  // Only the failed OpenRouter read is retried; DeepSeek is fresh and Anthropic is unavailable.
  assert.equal(calls, 4)

  await cache.get(keys, { forceRefresh: true })
  assert.equal(calls, 6)

  cache.clear()
  await cache.get(keys)
  assert.equal(calls, 9)
})

test('admin key verification explains keys without usage access', async () => {
  await assert.rejects(
    verifyOpenCodeAdminKey('anthropic', 'sk-ant-admin01', async () => respond({}, 403)),
    /rejected/
  )
  await assert.rejects(
    verifyOpenCodeAdminKey('groq', 'gsk', async () => respond({})),
    /does not support/
  )
  await verifyOpenCodeAdminKey('openai', 'sk-admin-x', async () =>
    respond({ data: [], has_more: false, next_page: null })
  )
})
