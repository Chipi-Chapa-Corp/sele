import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractOpenCodeGoApiKey,
  getOpenCodeAuthPath,
  openCodeAuthReadScript,
  resolveOpenCodeAuthContent,
  usesLocalOpenCodeAuth,
  fetchOpenCodeGoUsage,
  mapOpenCodeGoUsageToRateLimits,
  OpenCodeGoNoSubscriptionError,
  parseOpenCodeAuthContent
} from './OpenCodeUsage.ts'
import { isOpenCodeRateLimitError, renderOpenCodeChatItems } from './OpenCodeItemRenderers.ts'

test('prefers the opencode-go key over the zen key', () => {
  assert.equal(
    extractOpenCodeGoApiKey({
      opencode: { type: 'api', key: 'sk-zen' },
      'opencode-go': { type: 'api', key: 'sk-go' }
    }),
    'sk-go'
  )
})

test('falls back to the zen key when no go key is stored', () => {
  assert.equal(extractOpenCodeGoApiKey({ opencode: { type: 'api', key: 'sk-zen' } }), 'sk-zen')
})

test('returns null when no usable key is stored', () => {
  assert.equal(extractOpenCodeGoApiKey({ opencode: { type: 'oauth', access: '' } }), null)
  assert.equal(extractOpenCodeGoApiKey({}), null)
  assert.equal(parseOpenCodeAuthContent('not json'), null)
})

test('maps go usage windows to rate limits', () => {
  const rateLimits = mapOpenCodeGoUsageToRateLimits({
    rolling: { status: 'ok', percent: 65, resetsAt: '2026-09-07T10:00:00.000Z' },
    weekly: { status: 'ok', percent: 30, resetsAt: '2026-09-14T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 12, resetsAt: '2026-10-01T00:00:00.000Z' }
  })
  assert.equal(rateLimits.length, 3)
  assert.deepEqual(
    rateLimits.map((limit) => [limit.id, limit.displayLabel, limit.windowMinutes, limit.kind]),
    [
      ['five_hour', '5-hour limit', 300, 'primary'],
      ['weekly', 'Weekly limit', 10_080, 'secondary'],
      ['monthly', 'Monthly limit', 43_200, 'secondary']
    ]
  )
  assert.equal(rateLimits[0]?.usedPercent, 65)
  assert.equal(rateLimits[0]?.resetsAt, Date.parse('2026-09-07T10:00:00.000Z'))
})

test('skips windows without a numeric percent', () => {
  const rateLimits = mapOpenCodeGoUsageToRateLimits({
    rolling: { status: 'ok', percent: 101, resetsAt: null },
    weekly: null,
    monthly: { status: 'ok', percent: 'half' }
  })
  assert.equal(rateLimits.length, 1)
  assert.equal(rateLimits[0]?.usedPercent, 100)
  assert.equal(rateLimits[0]?.resetsAt, null)
})

test('fetches go usage with bearer auth', async () => {
  const requests = []
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const fetchFn = async (url, options) => {
    requests.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usage: {
          rolling: { status: 'ok', percent: 4, resetsAt: '2026-09-07T10:00:00.000Z' },
          weekly: { status: 'ok', percent: 3, resetsAt: '2026-09-14T00:00:00.000Z' },
          monthly: { status: 'ok', percent: 1, resetsAt: '2026-10-01T00:00:00.000Z' }
        }
      })
    }
  }
  const usage = await fetchOpenCodeGoUsage('sk-go', fetchFn)
  assert.equal(requests[0]?.url, 'https://opencode.ai/zen/go/v1/usage')
  assert.equal(requests[0]?.options.headers.authorization, 'Bearer sk-go')
  assert.equal(usage.monthly?.percent, 1)
})

test('treats missing subscription as no-subscription', async () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const fetchFn = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      type: 'error',
      error: { type: 'EntitlementError', message: 'OpenCode Go subscription required.' }
    })
  })
  await assert.rejects(fetchOpenCodeGoUsage('sk-zen', fetchFn), OpenCodeGoNoSubscriptionError)
})

test('detects opencode rate-limit errors', () => {
  assert.equal(isOpenCodeRateLimitError({ data: { message: 'GoUsageLimitError: limit' } }), true)
  assert.equal(isOpenCodeRateLimitError({ message: 'Free usage exceeded, subscribe to Go' }), true)
  assert.equal(isOpenCodeRateLimitError({ message: 'Error 429 from provider' }), true)
  assert.equal(isOpenCodeRateLimitError({ message: 'context too long' }), false)
  assert.equal(isOpenCodeRateLimitError(null), false)
})

test('valid environment auth is authoritative even without a Go key', async () => {
  for (const content of ['{}', '{"anthropic":{"type":"api","key":"other"}}']) {
    const resolved = await resolveOpenCodeAuthContent(content, async () => {
      assert.fail('must not fall back to another account on disk')
    })
    assert.equal(parseOpenCodeAuthContent(resolved), null)
  }
})

test('missing or malformed environment auth falls back to disk', async () => {
  const disk = '{"opencode-go":{"type":"api","key":"disk-key"}}'
  for (const content of [undefined, '', 'not json']) {
    assert.equal(await resolveOpenCodeAuthContent(content, async () => disk), disk)
  }
})

test('auth file location follows XDG and never guesses other stores', () => {
  assert.equal(
    getOpenCodeAuthPath({ XDG_DATA_HOME: '/data' }, '/home/test'),
    '/data/opencode/auth.json'
  )
  assert.equal(
    getOpenCodeAuthPath({ XDG_DATA_HOME: 'relative', OPENCODE_DATA_DIR: '/ignored' }, '/home/test'),
    '/home/test/.local/share/opencode/auth.json'
  )
})

test('host bridges and selected containers read credentials in their target', () => {
  assert.equal(usesLocalOpenCodeAuth(null, false, false), true)
  assert.equal(usesLocalOpenCodeAuth({ kind: 'host' }, false, true), false)
  assert.equal(usesLocalOpenCodeAuth(null, true, false), false)
  assert.equal(
    usesLocalOpenCodeAuth({ kind: 'container', tool: 'toolbox', name: 'dev' }, false, false),
    false
  )
})

test('target reader preserves multiline environment auth and reads the target XDG store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sele-opencode-auth-'))
  try {
    await mkdir(join(dir, 'opencode'))
    const disk = '{"opencode-go":{"type":"api","key":"target-disk"}}'
    await writeFile(join(dir, 'opencode', 'auth.json'), disk)
    const envContent = '{\n"opencode-go":{"type":"api","key":"target-env"}\n}'
    const output = execFileSync('sh', ['-c', openCodeAuthReadScript], {
      encoding: 'utf8',
      env: { ...process.env, XDG_DATA_HOME: dir, OPENCODE_AUTH_CONTENT: envContent }
    })
    assert.equal(output, envContent + '\0' + disk)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('structured 429 errors render as rate limits without matching unrelated request IDs', () => {
  const error = {
    name: 'APIError',
    data: { message: 'Too Many Requests', statusCode: 429, isRetryable: true }
  }
  assert.equal(isOpenCodeRateLimitError(error), true)
  assert.equal(
    isOpenCodeRateLimitError({ data: { message: 'Request 42901 failed', statusCode: 500 } }),
    false
  )
  const items = renderOpenCodeChatItems(
    [{ info: { id: 'a', role: 'assistant', time: { created: 1 }, error }, parts: [] }],
    { active: false, stopped: false }
  )
  assert.equal(items[0].failureReason, 'rateLimit')
})

test('unexpected forbidden and malformed responses remain visible errors', async () => {
  for (const response of [
    { status: 403, ok: false, json: async () => ({}) },
    { status: 200, ok: true, json: async () => ({}) }
  ]) {
    await assert.rejects(
      fetchOpenCodeGoUsage('key', async () => response),
      (error) => {
        assert.equal(error instanceof OpenCodeGoNoSubscriptionError, false)
        return true
      }
    )
  }
})

test('completed assistant messages do not end a still-active tool loop', () => {
  const messages = [
    {
      info: {
        id: 'a',
        role: 'assistant',
        time: { created: 1, completed: 2 },
        finish: 'tool-calls'
      },
      parts: [{ id: 'r', type: 'reasoning', text: 'Working on it' }]
    }
  ]
  assert.equal(
    renderOpenCodeChatItems(messages, { active: true, stopped: false })[0].status,
    'working'
  )
  assert.equal(
    renderOpenCodeChatItems(messages, { active: false, stopped: false })[0].status,
    'worked'
  )
  assert.equal(
    renderOpenCodeChatItems(messages, { active: false, stopped: true })[0].status,
    'stopped'
  )
})
