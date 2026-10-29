import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getOpenCodeConnectionFailure,
  openCodeConnectionsNeedCheck
} from '../../../shared/providerConnections.ts'
import {
  OpenCodeCredentialHealth,
  checkOpenCodeCredential,
  isOpenCodeCredentialError,
  sanitizeOpenCodeCredentialMessage,
  selectOpenCodeCheckModel
} from './OpenCodeCredentialHealth.ts'

const apiError = (statusCode, message, body, isRetryable = false) => ({
  name: 'APIError',
  data: {
    message,
    statusCode,
    isRetryable,
    ...(body ? { responseBody: JSON.stringify({ type: 'error', error: body }) } : {})
  }
})
const expiredKey = apiError(401, 'This API key has expired.')

test('connection health checks missing and stale results while reusing recent checks', () => {
  const now = 2_000_000
  const list = (status) => [{ connections: [{ status }] }]
  assert.equal(openCodeConnectionsNeedCheck(list(undefined), now), true)
  assert.equal(openCodeConnectionsNeedCheck(list({ checkedAt: now - 900_001 }), now), true)
  for (const state of ['failed', 'verified', 'unverified'])
    assert.equal(openCodeConnectionsNeedCheck(list({ state, checkedAt: now }), now), false)
  assert.equal(openCodeConnectionsNeedCheck([{ connections: [] }], now), false)
})

test('the chat failure follows the selected model and does not block usable alternatives', () => {
  const failed = { state: 'failed', message: 'Expired key', checkedAt: 1 }
  const providers = [
    { id: 'bad', name: 'Expired provider', connections: [{ status: failed }] },
    { id: 'good', name: 'Working provider', connections: [{ status: { state: 'verified' } }] },
    { id: 'public', name: 'Public provider', connections: [] },
    { id: 'unknown', name: 'Unchecked provider', connections: [{}] },
    {
      id: 'outage',
      name: 'Unavailable provider',
      connections: [{ status: { state: 'unverified' } }]
    },
    {
      id: 'mixed',
      name: 'Mixed provider',
      connections: [{ status: failed }, { status: { state: 'verified' } }]
    }
  ]
  assert.deepEqual(getOpenCodeConnectionFailure(providers, 'bad/model/variant'), {
    name: 'Expired provider',
    message: 'Expired key'
  })
  for (const model of [
    'good/model',
    'public/free',
    'unknown/model',
    'outage/model',
    'mixed/model',
    'absent/model',
    '',
    'bad'
  ])
    assert.equal(getOpenCodeConnectionFailure(providers, model), null, model)
})

test('usage-only admin keys do not hide or cause model connection failures', () => {
  const failed = { state: 'failed', message: 'Expired key', checkedAt: 1 }
  const verified = { state: 'verified', checkedAt: 1 }
  const admin = (status) => ({
    type: 'credential',
    id: 'sele-admin:anthropic',
    label: 'Admin key',
    usageOnly: true,
    status
  })
  const provider = (connections) => [
    { id: 'anthropic', name: 'Anthropic', methods: [], connections }
  ]
  assert.deepEqual(
    getOpenCodeConnectionFailure(
      provider([
        { type: 'credential', id: 'anthropic', label: 'API key', status: failed },
        admin(verified)
      ]),
      'anthropic/claude'
    ),
    { name: 'Anthropic', message: 'Expired key' }
  )
  assert.equal(getOpenCodeConnectionFailure(provider([admin(failed)]), 'anthropic/claude'), null)
})
// Recorded from api.anthropic.com for an organization-level key.
const workspaceKey = apiError(
  400,
  'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.',
  { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace' }
)

test('recognizes credential failures across status codes, but not other request errors', () => {
  assert.equal(isOpenCodeCredentialError(expiredKey), true)
  assert.equal(isOpenCodeCredentialError(workspaceKey), true)
  assert.equal(
    isOpenCodeCredentialError({
      name: 'ProviderAuthError',
      data: { providerID: 'x', message: '' }
    }),
    true
  )
  assert.equal(
    isOpenCodeCredentialError(apiError(403, 'Forbidden', { type: 'permission_error' })),
    true
  )
  assert.equal(
    isOpenCodeCredentialError(
      apiError(400, 'max_tokens is too large', { type: 'invalid_request_error' })
    ),
    false
  )
  assert.equal(
    isOpenCodeCredentialError(apiError(403, 'Model not available in your region')),
    false
  )
  assert.equal(isOpenCodeCredentialError(apiError(429, 'Rate limited')), false)
  assert.equal(isOpenCodeCredentialError(apiError(500, 'Overloaded', null, true)), false)
  assert.equal(isOpenCodeCredentialError({ name: 'MessageAbortedError', data: {} }), false)
})

test('strips key-like tokens and bounds provider messages', () => {
  assert.equal(
    sanitizeOpenCodeCredentialMessage(
      'Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz123'
    ),
    'Incorrect API key provided: …'
  )
  assert.equal(sanitizeOpenCodeCredentialMessage('x '.repeat(400)).length, 300)
})

const model = (id, cost, extra = {}) => ({
  id,
  status: 'active',
  cost: { input: cost, output: cost * 5, cache: { read: 0, write: 0 } },
  capabilities: { input: { text: true }, output: { text: true } },
  ...extra
})

test('checks with a free model first, then the cheapest usable one', () => {
  const provider = (models) => ({
    id: 'p',
    models: Object.fromEntries(models.map((m) => [m.id, m]))
  })
  assert.equal(
    selectOpenCodeCheckModel(
      provider([
        model('opus', 4),
        model('haiku', 0.1),
        model('old', 0.01, { status: 'deprecated' }),
        model('embed', 0.001, {
          capabilities: { input: { text: true }, output: { text: false } }
        })
      ])
    ),
    'haiku'
  )
  assert.equal(selectOpenCodeCheckModel(provider([model('paid', 1), model('free', 0)])), 'free')
  assert.equal(selectOpenCodeCheckModel(provider([])), null)
})

const fakeClient = ({ reply, promptThrows = false, models = [model('haiku', 0.1)] } = {}) => {
  const calls = []
  const client = {
    provider: {
      list: async () => ({
        data: {
          all: [{ id: 'anthropic', models: Object.fromEntries(models.map((m) => [m.id, m])) }]
        }
      })
    },
    session: {
      create: async (input) => {
        calls.push(['create', input])
        return { data: { id: 'ses_check' } }
      },
      prompt: async (input) => {
        calls.push(['prompt', input])
        if (promptThrows) throw new Error('socket closed')
        return { data: { info: { role: 'assistant', ...reply }, parts: [] } }
      },
      abort: async () => calls.push(['abort']),
      delete: async (input) => calls.push(['delete', input.sessionID])
    }
  }
  return { client, calls }
}
const check = (client, extra) =>
  checkOpenCodeCredential({ client, directory: '/home', providerId: 'anthropic', ...extra })

test('a check sends one tool-less prompt with the cheapest model and removes its session', async () => {
  const { client, calls } = fakeClient({ reply: {} })
  const sessions = []
  const status = await check(client, { onSession: (id) => sessions.push(id) })
  assert.equal(status.state, 'verified')
  assert.deepEqual(sessions, ['ses_check'])
  const create = calls.find(([name]) => name === 'create')[1]
  assert.deepEqual(create.permission, [{ permission: '*', pattern: '*', action: 'deny' }])
  assert.deepEqual(create.metadata, { sele: { purpose: 'oneShot' } })
  const prompt = calls.find(([name]) => name === 'prompt')[1]
  assert.equal(prompt.agent, 'build')
  assert.deepEqual(prompt.model, { providerID: 'anthropic', modelID: 'haiku' })
  assert.deepEqual(calls.at(-1), ['delete', 'ses_check'])
})

test('a check reports what the provider said, and separates outages from bad credentials', async () => {
  const failed = await check(fakeClient({ reply: { error: workspaceKey } }).client)
  assert.equal(failed.state, 'failed')
  assert.match(failed.message, /not scoped to a workspace/)

  const limited = await check(
    fakeClient({ reply: { error: apiError(429, 'Rate limited') } }).client
  )
  assert.deepEqual([limited.state, limited.message], ['unverified', 'Rate limited'])

  const outage = await check(
    fakeClient({ reply: { error: apiError(529, 'Overloaded', null, true) } }).client
  )
  assert.equal(outage.state, 'unverified')

  const { client, calls } = fakeClient({ promptThrows: true })
  const unreachable = await check(client)
  assert.deepEqual(
    [unreachable.state, unreachable.message],
    ['unverified', 'OpenCode could not run the check.']
  )
  assert.deepEqual(calls.at(-1), ['delete', 'ses_check'])

  const noModel = await check(fakeClient({ models: [] }).client)
  assert.equal(noModel.state, 'unverified')
})

test('real replies update the status: credential failures, then a completed reply', () => {
  const health = new OpenCodeCredentialHealth()
  health.record('host', {
    role: 'assistant',
    providerID: 'anthropic',
    error: workspaceKey,
    time: {}
  })
  assert.equal(health.get('host', 'anthropic').state, 'failed')
  assert.match(health.get('host', 'anthropic').message, /not scoped to a workspace/)
  assert.equal(health.get('container', 'anthropic'), undefined)

  // Streaming updates, unrelated failures, and user messages leave it alone.
  health.record('host', { role: 'assistant', providerID: 'anthropic', time: { created: 1 } })
  health.record('host', {
    role: 'assistant',
    providerID: 'anthropic',
    error: apiError(500, 'Overloaded', null, true),
    time: { created: 1, completed: 2 }
  })
  health.record('host', { role: 'user', providerID: 'anthropic', time: { created: 1 } })
  assert.equal(health.get('host', 'anthropic').state, 'failed')

  health.record('host', {
    role: 'assistant',
    providerID: 'anthropic',
    time: { created: 1, completed: 2 }
  })
  assert.deepEqual(health.get('host', 'anthropic'), { state: 'verified', checkedAt: 2 })

  health.clear('host', 'anthropic')
  assert.equal(health.get('host', 'anthropic'), undefined)
})
