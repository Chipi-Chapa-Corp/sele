import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mapClaudeResetCredits,
  consumeClaudeResetCredit,
  readClaudeResetAccount
} from './ClaudeResetCredits.ts'
import { isClaudeAuthenticationError } from './ClaudeAuthentication.ts'

const now = Date.parse('2026-11-12T12:00:00Z')
const grant = (changes = {}) => ({
  id: 'full-reset',
  resets_left: 2,
  usable_now: true,
  paused: false,
  starts_at: '2026-11-10T12:00:00Z',
  ends_at: '2026-12-10T22:00:00Z',
  clears: ['five_hour', 'seven_day'],
  ...changes
})
const usage = (...grants) => ({
  cedar_ember: { eligible: true, next_grant_id: 'full-reset', grants }
})

test('banked inventory counts remaining uses and preserves separate scope choices and deadlines', () => {
  const actual = mapClaudeResetCredits(
    usage(
      grant(),
      grant({ id: 'fable', resets_left: 1, gives_back_weekly: true }),
      grant({ id: 'session', type: 'session' }),
      grant({ id: 'weekly', clears: ['seven_day'] })
    ),
    now
  )
  assert.equal(actual.availableCount, 7)
  assert.equal(actual.credits.length, 7)
  assert.deepEqual(
    actual.options.map((option) => option.label),
    ['Full reset', 'Fable reset', '5-hour reset', 'Weekly reset']
  )
  assert.match(actual.options[1].description, /Other weekly usage stays unchanged/)
  assert.equal(actual.credits[0].expiresAt, Date.parse('2026-12-10T22:00:00Z'))
  assert.equal(actual.nextCreditId, 'full-reset')
})

test('expired, future, paused, duplicate, spent and malformed grants cannot inflate inventory', () => {
  const actual = mapClaudeResetCredits(
    usage(
      grant(),
      grant(),
      grant({ id: 'expired', ends_at: new Date(now).toISOString() }),
      grant({ id: 'future', starts_at: new Date(now + 1).toISOString() }),
      grant({ id: 'paused', paused: true }),
      grant({ id: 'spent', resets_left: 0 }),
      grant({ id: '../bad' }),
      grant({ id: 'bad-date', ends_at: 'tomorrow' }),
      grant({ id: 'bad-count', resets_left: 1.5 }),
      null
    ),
    now
  )
  assert.equal(actual.availableCount, 2)
  assert.equal(actual.options.length, 1)
  assert.equal(mapClaudeResetCredits({}), null)
  assert.equal(
    mapClaudeResetCredits({ cedar_ember: { eligible: false, grants: [grant()] } }, now)
      .availableCount,
    0
  )
})

test('temporarily unavailable banked resets remain visible but cannot be redeemed', () => {
  assert.equal(
    mapClaudeResetCredits(usage(grant({ usable_now: false })), now).options[0].usable,
    false
  )
  const value = usage(grant())
  value.cedar_ember.cooldown_until = new Date(now + 1000).toISOString()
  assert.equal(mapClaudeResetCredits(value, now).options[0].usable, false)
})

test('identity and claims use the selected bearer, explicit grant and reusable request ID', async () => {
  const calls = []
  const fetchFn = async (url, options) => {
    calls.push([url, options])
    assert.equal(options.headers.Authorization, 'Bearer account-b')
    assert.equal(options.headers['User-Agent'], 'claude-cli/2.1.322 (external, cli)')
    assert.equal(options.redirect, 'error')
    return Response.json(
      options.method === 'POST'
        ? { result: 'reset' }
        : { organization: { uuid: 'org-b' }, account: { uuid: 'account-b' } }
    )
  }
  assert.deepEqual(await readClaudeResetAccount('account-b', '2.1.322', fetchFn), {
    organization: 'org-b',
    account: 'account-b'
  })
  assert.equal(
    await consumeClaudeResetCredit(
      'account-b',
      '2.1.322',
      'org-b',
      'full-reset',
      'request-1',
      fetchFn
    ),
    'reset'
  )
  assert.equal(calls[1][0], 'https://api.anthropic.com/api/organizations/org-b/reset_rate_limits')
  assert.deepEqual(JSON.parse(calls[1][1].body), {
    program: 'cedar_ember',
    grant_id: 'full-reset',
    request_id: 'request-1'
  })
})

test('claims map definitive outcomes and never report success for uncertain or rejected responses', async () => {
  const claim = (fetchFn) =>
    consumeClaudeResetCredit(
      'private-token',
      '2.1.322',
      'org-b',
      'full-reset',
      'request-1',
      fetchFn
    )
  for (const [result, outcome] of Object.entries({
    reset: 'reset',
    not_limited: 'nothingToReset',
    already_used: 'alreadyRedeemed',
    ineligible: 'noCredit'
  }))
    assert.equal(await claim(async () => Response.json({ result })), outcome)
  for (const result of ['cooldown', 'unavailable', 'unknown', undefined])
    await assert.rejects(claim(async () => Response.json({ result })))
  for (const status of [401, 403, 429, 500])
    await assert.rejects(
      claim(async () => Response.json({ error: 'private upstream body' }, { status })),
      (error) => {
        assert.equal(isClaudeAuthenticationError(error), status === 401 || status === 403)
        assert.doesNotMatch(error.message, /private-token|private upstream body/)
        return true
      }
    )
  await assert.rejects(
    claim(async () => {
      throw new Error('private transport details')
    }),
    /Unable to confirm/
  )
  await assert.rejects(
    claim(async () => new Response('bad-json')),
    /Unable to confirm/
  )
  await assert.rejects(
    consumeClaudeResetCredit('t', 'v', '../bad', 'full-reset', 'r', () =>
      assert.fail('invalid claims must not send')
    ),
    /Invalid/
  )
})
