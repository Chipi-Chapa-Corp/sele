import assert from 'node:assert/strict'
import test from 'node:test'
import {
  codexAccountDisplayName,
  claudeAccountDisplayName,
  copilotAccountDisplayName
} from './AccountDisplayName.ts'

const auth = (claims) =>
  JSON.stringify({
    tokens: {
      id_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
    }
  })

test('Codex reads provider name with email fallback and tolerates absent or malformed credentials', () => {
  assert.equal(
    codexAccountDisplayName(auth({ name: '  Jane Doe ', email: 'jane@example.com' })),
    'Jane Doe'
  )
  assert.equal(codexAccountDisplayName(auth({ email: 'jane@example.com' })), 'jane@example.com')
  assert.equal(
    codexAccountDisplayName(
      auth({ 'https://api.openai.com/profile': { email: 'work@example.com' } })
    ),
    'work@example.com'
  )
  for (const content of ['{secret', '{}', auth(null)])
    assert.equal(codexAccountDisplayName(content), null)
})

test('Claude profiles are cached by credential and never mix managed accounts', async () => {
  const seen = []
  const fetchFn = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/api/oauth/profile')
    seen.push(options.headers.Authorization)
    return {
      ok: true,
      json: async () => ({
        account: {
          display_name: options.headers.Authorization.endsWith('work')
            ? 'Work Name'
            : 'Personal Name',
          full_name: 'Fallback'
        }
      })
    }
  }
  assert.equal(await claudeAccountDisplayName('fixture-work', '1.0', fetchFn), 'Work Name')
  assert.equal(await claudeAccountDisplayName('fixture-personal', '1.0', fetchFn), 'Personal Name')
  assert.equal(await claudeAccountDisplayName('fixture-work', '1.0', fetchFn), 'Work Name')
  assert.equal(seen.length, 2)
  assert.equal(
    await claudeAccountDisplayName('fixture-offline', '1.0', async () => {
      throw new Error('secret')
    }),
    null
  )
})

test('Copilot reads the GitHub profile name and handles unavailable profiles', async () => {
  assert.equal(
    await copilotAccountDisplayName(
      'fixture-person',
      'https://github.com',
      async (url, options) => {
        assert.equal(String(url), 'https://api.github.com/users/fixture-person')
        assert.equal(options.headers.Authorization, undefined)
        return { ok: true, json: async () => ({ name: 'Jane Doe' }) }
      }
    ),
    'Jane Doe'
  )
  assert.equal(
    await copilotAccountDisplayName('fixture-missing', undefined, async () => ({ ok: false })),
    null
  )
})

test('transient profile failures are retried without requiring an account switch', async () => {
  let calls = 0
  const fetchFn = async () =>
    ++calls === 1
      ? { ok: false }
      : { ok: true, json: async () => ({ account: { display_name: 'Recovered Name' } }) }
  assert.equal(await claudeAccountDisplayName('fixture-retry-before-switch', '1.0', fetchFn), null)
  assert.equal(
    await claudeAccountDisplayName('fixture-retry-before-switch', '1.0', fetchFn),
    'Recovered Name'
  )
  assert.equal(calls, 2)
})
