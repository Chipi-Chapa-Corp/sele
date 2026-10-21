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

test('reads abliteration.ai credits with the normal key', async () => {
  const { requests, fetchFn } = recordingFetch(() =>
    respond({ data: { total_credits: 25, total_usage: 7.5 } })
  )
  const [credits] = await fetchOpenCodeBalance(
    'abliteration-ai',
    { key: 'ab-key', admin: false },
    fetchFn,
    now
  )
  assert.equal(requests[0].url, 'https://api.abliteration.ai/v1/credits')
  assert.equal(requests[0].headers.authorization, 'Bearer ab-key')
  assert.deepEqual(
    [credits.kind, credits.amount, credits.modelProviderName],
    ['remaining', 17.5, 'abliteration.ai']
  )
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

test('adds an estimate for the unbilled current day from hourly token usage', async () => {
  const { requests, fetchFn } = recordingFetch((url) =>
    url.includes('usage_report')
      ? respond({
          data: [
            {
              starting_at: '2026-10-21T10:00:00Z',
              results: [
                {
                  model: 'claude-opus-5-5',
                  uncached_input_tokens: 1_000_000,
                  cache_creation: {
                    ephemeral_5m_input_tokens: 1_000_000,
                    ephemeral_1h_input_tokens: 0
                  },
                  cache_read_input_tokens: 10_000_000,
                  output_tokens: 100_000
                }
              ]
            }
          ],
          has_more: false,
          next_page: null
        })
      : respond({
          data: [
            { ending_at: '2026-10-21T00:00:00Z', results: [{ amount: '14', currency: 'USD' }] }
          ],
          has_more: false,
          next_page: null
        })
  )
  const priced = []
  const priceModels = async (models) => {
    priced.push(...models)
    return models.map((model) => ({
      ...model,
      rates: { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 }
    }))
  }
  const [balance] = await fetchOpenCodeBalance(
    'anthropic',
    { key: 'sk-ant-admin01', admin: true },
    fetchFn,
    now,
    priceModels
  )
  const usage = new URL(requests[1].url)
  assert.equal(usage.pathname, '/v1/organizations/usage_report/messages')
  assert.equal(usage.searchParams.get('starting_at'), '2026-10-21T00:00:00.000Z')
  assert.equal(usage.searchParams.get('bucket_width'), '1h')
  assert.deepEqual(usage.searchParams.getAll('group_by[]'), ['model'])
  assert.deepEqual(priced[0].usage, {
    inputTokens: 2_000_000,
    cachedInputTokens: 10_000_000,
    outputTokens: 100_000
  })
  // 1M input $5 + 1M cache write $6.25 + 10M cache read $5 + 100k output $2.50
  assert.ok(Math.abs(balance.estimatedAmount - 18.75) < 1e-9)
  assert.ok(Math.abs(balance.amount - 18.89) < 1e-9)
})

test('skips the estimate without pricing or usage', async () => {
  const costs = async () => respond({ data: [], has_more: false, next_page: null })
  const [withoutPricing] = await fetchOpenCodeBalance(
    'anthropic',
    { key: 'k', admin: true },
    costs,
    now
  )
  assert.equal(withoutPricing.estimatedAmount, null)
  const { requests, fetchFn } = recordingFetch(costs)
  const [withoutUsage] = await fetchOpenCodeBalance(
    'anthropic',
    { key: 'k', admin: true },
    fetchFn,
    now,
    async () => assert.fail('nothing to price')
  )
  assert.equal(requests.length, 2)
  assert.deepEqual([withoutUsage.amount, withoutUsage.estimatedAmount], [0, null])
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

// Response samples follow each provider's documented schema.
const providerCases = [
  [
    'aiand',
    'https://api.aiand.com/billing/balance',
    { balance: '12.5', currency: 'jpy' },
    12.5,
    'JPY'
  ],
  [
    'aimlapi',
    'https://api.aimlapi.com/v2/billing',
    { current_balance: 3.2, currency: 'USD' },
    3.2,
    'USD'
  ],
  ['coralbricks', 'https://inference.coralbricks.ai/v1/quota', { balance: 4 }, 4, 'USD'],
  ['crossmodel', 'https://api.crossmodel.ai/v1/credits', { balance_micro: 2_500_000 }, 2.5, 'USD'],
  [
    'deepinfra',
    'https://api.deepinfra.com/payment/checklist',
    { stripe_balance: -7.25 },
    7.25,
    'USD'
  ],
  [
    'empiriolabs',
    'https://api.empiriolabs.ai/v1/account/usage',
    { balance: { amount: 9, currency: 'usd' } },
    9,
    'USD'
  ],
  ['frogbot', 'https://app.frogbot.ai/api/v1/quota', { balanceUSD: 1.5 }, 1.5, 'USD'],
  [
    'impossibl',
    'https://api.impossibl.com/v1/account',
    { balance: { usd: 6, credits: 6e6 } },
    6,
    'USD'
  ],
  [
    'kenari',
    'https://kenari.id/v1/account/balance',
    { available_micro_idr: 50_000e6 },
    50_000,
    'IDR'
  ],
  [
    'meganova',
    'https://api.meganova.ai/api/v1/users/credits',
    { data: { available_balance: '1228.556' } },
    1228.556,
    'USD'
  ],
  [
    'neuralwatt',
    'https://api.neuralwatt.com/v1/quota',
    { balance: { credits_remaining_usd: 8 } },
    8,
    'USD'
  ],
  [
    'novita-ai',
    'https://api.novita.ai/openapi/v1/billing/balance/detail',
    { availableBalance: '125000' },
    12.5,
    'USD'
  ],
  ['ofox', 'https://api.ofox.ai/v1/user/balance', { balance: 3, currency: 'USD' }, 3, 'USD'],
  [
    'ollama-cloud',
    'https://ollama.com/api/balance',
    { included: { balance_usd: 10 }, purchased: { balance_usd: 2.5 } },
    12.5,
    'USD'
  ],
  ['orcarouter', 'https://api.orcarouter.ai/v1/tools/balance', { spendable_usd: 4.4 }, 4.4, 'USD'],
  ['pareto', 'https://api.paretoinference.com/v1/balance', { balance: '5.10' }, 5.1, 'USD'],
  [
    'poe',
    'https://api.poe.com/usage/current_balance',
    { current_point_balance: 120_000 },
    120_000,
    'points'
  ],
  ['prime', 'https://api.primeintellect.ai/api/v1/billing/wallet', { balance_usd: 20 }, 20, 'USD'],
  ['runinfra', 'https://api.runinfra.ai/v1/credits', { available_cents: 1234 }, 12.34, 'USD'],
  ['stepfun', 'https://api.stepfun.com/v1/accounts', { balance: 88 }, 88, 'CNY'],
  ['stepfun-ai', 'https://api.stepfun.ai/v1/accounts', { balance: 8 }, 8, 'USD'],
  [
    'umans-ai',
    'https://app.umans.ai/api/v1/wallet/summary',
    { balance: { balanceCents: 950 } },
    9.5,
    'USD'
  ],
  [
    'unorouter',
    'https://api.unorouter.com/api/usage/token/',
    { data: { total_available: 1_000_000 } },
    2,
    'USD'
  ],
  [
    'venice',
    'https://api.venice.ai/api/v1/billing/balance',
    { balances: { usd: 11, diem: 3 } },
    11,
    'USD'
  ],
  [
    'vercel',
    'https://ai-gateway.vercel.sh/v1/credits',
    { balance: '95.50', total_used: '4.50' },
    95.5,
    'USD'
  ],
  ['opper', 'https://api.opper.ai/v3/me', { balance: { balance_cents: 250 } }, 2.5, 'USD']
]

test('reads documented balances for each supported provider', async () => {
  for (const [providerId, url, payload, amount, currency] of providerCases) {
    const { requests, fetchFn } = recordingFetch(() => respond(payload))
    const [result] = await fetchOpenCodeBalance(
      providerId,
      { key: 'key', admin: false },
      fetchFn,
      now
    )
    assert.equal(requests[0].url, url, providerId)
    assert.equal(requests[0].headers.authorization, 'Bearer key', providerId)
    assert.equal(result?.kind, 'remaining', providerId)
    assert.ok(Math.abs(result.amount - amount) < 1e-9, `${providerId}: ${result.amount}`)
    assert.equal(result.currency, currency, providerId)
    assert.equal(result.modelProviderId, providerId)
  }
})

test('NanoGPT posts with x-api-key', async () => {
  const requests = []
  const [result] = await fetchOpenCodeBalance(
    'nano-gpt',
    { key: 'ng', admin: false },
    async (url, options) => {
      requests.push({ url, options })
      return respond({ usd_balance: '3.75', nano_balance: '1' })
    },
    now
  )
  assert.equal(requests[0].url, 'https://nano-gpt.com/api/check-balance')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.headers['x-api-key'], 'ng')
  assert.equal(result.amount, 3.75)
})

test('Requesty and LLM Gateway report spend against a limit', async () => {
  const [requesty] = await fetchOpenCodeBalance(
    'requesty',
    { key: 'k', admin: false },
    async () => respond({ monthly_spend: 12, monthly_limit: 0 }),
    now
  )
  assert.deepEqual([requesty.kind, requesty.amount, requesty.limit], ['spent', 12, null])
  const [plan] = await fetchOpenCodeBalance(
    'llmgateway',
    { key: 'k', admin: false },
    async () =>
      respond({
        devPlan: 'pro',
        devPlanCreditsUsed: '20.5',
        devPlanCreditsLimit: '50',
        usage: '99'
      }),
    now
  )
  assert.deepEqual([plan.label, plan.amount, plan.limit], ['DevPass this cycle', 20.5, 50])
  assert.deepEqual(
    await fetchOpenCodeBalance(
      'llmgateway-providers',
      { key: 'k', admin: false },
      async () => respond({ devPlan: 'none', usage: '3', limit: null }),
      now
    ),
    []
  )
})

test('management-key providers ignore inference keys', async () => {
  assert.deepEqual(
    selectOpenCodeBalanceKeys({ aihubmix: 'sk-x', cortecs: 'c', vercel: 'v' }, { zenmux: 'mgmt' }),
    { vercel: { key: 'v', admin: false }, zenmux: { key: 'mgmt', admin: true } }
  )
  const [aihubmix] = await fetchOpenCodeBalance(
    'aihubmix',
    { key: 'fd-key', admin: true },
    async () => respond({ data: { quota: 2_500_000, used_quota: 500_000 } }),
    now
  )
  assert.equal(aihubmix.amount, 5)
})

test('keys without billing permission hide the balance where providers restrict it', async () => {
  for (const providerId of ['kenari', 'prime', 'opper'])
    await assert.rejects(
      fetchOpenCodeBalance(
        providerId,
        { key: 'k', admin: false },
        async () => respond({}, 403),
        now
      ),
      OpenCodeBalanceUnavailableError
    )
  // Opper omits the balance for members without billing access.
  assert.deepEqual(
    await fetchOpenCodeBalance(
      'opper',
      { key: 'k', admin: false },
      async () => respond({ id: 'me' }),
      now
    ),
    []
  )
})
