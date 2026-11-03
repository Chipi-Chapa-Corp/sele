import assert from 'node:assert/strict'
import test from 'node:test'
import { isProviderUsageLimitError } from '../../shared/providerErrors.ts'
import { isTransientProviderFailure } from './ProviderNetworkRetry.ts'
import { getChatItems } from './codex/CodexItemRenderers.ts'
import { ClaudeTranscriptProjection, renderClaudeChatItems } from './claude/ClaudeItemRenderers.ts'
import { renderCopilotChatItems } from './copilot/CopilotItemRenderers.ts'
import { renderOpenCodeChatItems } from './opencode/OpenCodeItemRenderers.ts'
import { getOpenCodeUsageLimitMessage } from './opencode/OpenCodeUsageLimit.ts'

const options = { active: false, stopped: false }
const claudeUser = {
  type: 'user',
  uuid: 'user',
  session_id: 'chat',
  parent_tool_use_id: null,
  message: { content: 'Continue' }
}
const claudeError = (error, message) => ({
  type: 'assistant',
  uuid: 'error',
  session_id: 'chat',
  parent_tool_use_id: null,
  error,
  message: { content: [{ type: 'text', text: message }] }
})
const failedStep = (items) =>
  items.find((item) => item.type === 'working' && item.status === 'failed')

test('recognizes structured rate, quota, billing and credit failures without relying on prose', () => {
  for (const error of [
    { code: 'usageLimitExceeded' },
    { codexErrorInfo: 'rateLimitExceeded' },
    { errorType: 'quota', message: 'Request rejected' },
    { errorCode: 'user_weekly_rate_limited' },
    { errorCode: 'billing_not_configured' },
    { code: 'billing_error' },
    { status: 429 },
    { data: { statusCode: '429' } },
    { name: 'GoUsageLimitError' },
    { type: 'provider.free-limit' },
    { data: { responseBody: '{"error":{"code":"insufficient_quota"}}' } },
    Object.assign(new Error('Request rejected'), { status: 429 }),
    new Error('Connection failed', { cause: { status: 429 } })
  ])
    assert.equal(isProviderUsageLimitError(error), true, JSON.stringify(error))
})

test('legacy limit messages are recognized and cannot enter the network retry flow', () => {
  for (const message of [
    'HTTP 429: overloaded',
    'Too many requests',
    'rate_limit_error: overloaded',
    'Your usage limit has been reached',
    'You have exceeded your current quota',
    'insufficient_quota: fetch failed',
    'Credit balance is too low: fetch failed',
    'Out of credits: overloaded',
    'You’ve hit your limit · resets 5pm (UTC)',
    'Spending limit reached',
    'Subscription required: fetch failed'
  ]) {
    assert.equal(isProviderUsageLimitError(message), true, message)
    assert.equal(isTransientProviderFailure(message), false, message)
  }
})

test('request limits, authentication, cancellation and outages do not become usage failures', () => {
  for (const error of [
    { errorType: 'context_limit', message: 'The request exceeds the context limit' },
    { name: 'ContextOverflowError', data: { message: 'Context length limit exceeded' } },
    { code: 'max_output_tokens' },
    { code: 'error_max_turns' },
    { code: 'error_max_budget_usd', message: 'Local usage limit reached' },
    { code: 'authentication_failed' },
    { errorType: 'authentication', message: 'Failed to authenticate while reading rate limits' },
    { status: 401 },
    { status: 403 },
    { status: 503 },
    { name: 'MessageAbortedError' },
    'Model capacity exceeded',
    'Overloaded',
    'Context length limit exceeded',
    'Maximum output tokens exceeded',
    'Command failed on line 429',
    { code: 'context_limit', message: 'Reduce usage limit in your context settings' },
    { data: { responseBody: '{"code":"context_limit","message":"Reduce usage limit"}' } },
    { input: { message: 'Rate limit exceeded' }, stdout: 'HTTP 429', content: 'Out of credits' }
  ])
    assert.equal(isProviderUsageLimitError(error), false, JSON.stringify(error))
  const cyclic = { message: 'fetch failed' }
  cyclic.cause = cyclic
  assert.equal(isProviderUsageLimitError(cyclic), false)
  assert.equal(isProviderUsageLimitError({ data: { responseBody: '{invalid' } }), false)
})

test('Claude projects all native assistant errors as failures in full and incremental history', () => {
  for (const [code, message, reason] of [
    ['rate_limit', 'Request rejected', 'rateLimit'],
    ['billing_error', 'Please review billing', 'rateLimit'],
    ['authentication_failed', 'Sign in again', 'authentication'],
    ['overloaded', 'The server is overloaded', undefined],
    ['invalid_request', 'Invalid request', undefined],
    ['max_output_tokens', 'Maximum output tokens exceeded', undefined]
  ]) {
    const messages = [claudeUser, claudeError(code, message)]
    const projection = new ClaudeTranscriptProjection()
    projection.read([claudeUser], [], options)
    const before = structuredClone(projection.read(messages, [], options))
    for (const items of [renderClaudeChatItems(messages, options), before.items]) {
      const failure = failedStep(items)
      assert.equal(failure?.failureReason, reason, code)
      assert.equal(failure?.failureMessage, message, code)
      assert.equal(
        items.some((item) => item.role === 'assistant'),
        false,
        code
      )
    }
    // A temporary later turn must not overwrite the committed failure's classification.
    projection.read(messages, [{ ...claudeUser, uuid: 'next' }], { ...options, active: true })
    assert.deepEqual(projection.read(messages, [], options), before)
  }
})

test('Claude system failures classify limits while ordinary assistant explanations remain successful', () => {
  const message = 'You have exceeded your current quota'
  for (const source of [
    [claudeUser, { ...claudeError(undefined, message), type: 'system', failed: true }],
    [claudeUser, { ...claudeError('rate_limit', 'Request rejected'), type: 'system', failed: true }]
  ]) {
    // System records use a plain content string.
    source[1].message.content = source[1].message.content[0].text
    for (const items of [
      renderClaudeChatItems(source, options),
      new ClaudeTranscriptProjection().read(source, [], options).items
    ])
      assert.equal(failedStep(items)?.failureReason, 'rateLimit')
  }
  const items = renderClaudeChatItems([claudeUser, claudeError(undefined, message)], options)
  assert.equal(failedStep(items), undefined)
  assert.equal(items.at(-1).content, message)
})

test('Codex classifies both typed limits and legacy failure details', () => {
  for (const error of [
    { codexErrorInfo: 'usageLimitExceeded', message: 'Request rejected' },
    { codexErrorInfo: 'rateLimitExceeded', message: 'Request rejected' },
    { message: 'Request rejected', additionalDetails: 'Insufficient credits' },
    { message: 'HTTP 429' }
  ]) {
    const step = failedStep(getChatItems([{ id: 'turn', status: 'failed', error, items: [] }]))
    assert.equal(step?.failureReason, 'rateLimit')
    assert.ok(step.failureMessage.includes(error.message))
  }
})

test('Copilot uses the error category and code, retaining ordinary context failures', () => {
  for (const [errorType, errorCode, message, reason] of [
    ['rate_limit', undefined, 'Request rejected', 'rateLimit'],
    ['quota', undefined, 'Request rejected', 'rateLimit'],
    ['query', 'user_global_rate_limited', 'Request rejected', 'rateLimit'],
    ['query', undefined, 'HTTP 429', 'rateLimit'],
    ['context_limit', undefined, 'Context length exceeded', undefined],
    ['authentication', undefined, 'Sign in again', undefined],
    ['query', undefined, 'fetch failed', undefined]
  ]) {
    const items = renderCopilotChatItems(
      [
        { id: 'user', type: 'user.message', data: { content: 'Continue' } },
        { id: 'error', type: 'session.error', data: { errorType, errorCode, message } }
      ],
      options
    )
    const step = failedStep(items)
    assert.equal(step?.failureReason, reason, errorType)
    assert.equal(step?.failureMessage, message)
  }
})

test('OpenCode live events, saved errors and state-only failures agree on usage limits', () => {
  for (const error of [
    'Insufficient credits',
    { name: 'APIError', data: { message: 'Insufficient credits' } },
    { name: 'APIError', data: { message: 'Request rejected', statusCode: 429 } },
    { name: 'APIError', data: { responseBody: '{"error":{"code":"insufficient_quota"}}' } },
    { name: 'APIError', data: { message: 'HTTP 503' } },
    { name: 'ContextOverflowError', data: { message: 'Context length limit exceeded' } }
  ]) {
    const liveMessage = getOpenCodeUsageLimitMessage('session.error', { error })
    const info = { id: 'assistant', role: 'assistant', time: { created: 1, completed: 2 }, error }
    const saved = failedStep(renderOpenCodeChatItems([{ info, parts: [] }], options))
    assert.equal(saved?.failureReason === 'rateLimit', liveMessage !== null)
    if (liveMessage) {
      const stateOnly = failedStep(
        renderOpenCodeChatItems(
          [
            {
              info: { id: 'user', role: 'user', time: { created: 1 } },
              parts: [{ type: 'text', text: 'Continue' }]
            }
          ],
          { ...options, failed: true, failureMessage: liveMessage }
        )
      )
      assert.equal(stateOnly?.failureReason, 'rateLimit')
    }
  }
})
