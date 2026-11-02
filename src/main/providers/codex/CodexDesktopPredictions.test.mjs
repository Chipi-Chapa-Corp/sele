import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { CodexPromptSuggestions } from './CodexPromptSuggestions.ts'
import { CodexDesktopPredictions } from './CodexDesktopPredictions.ts'
import { CodexDesktopPredictionConfig } from './CodexDesktopPredictionConfig.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const unavailable = () =>
  Object.assign(new Error('thread/prediction/request is not implemented yet'), { code: -32601 })
const defaults = {
  is_enabled: true,
  prompt: 'SERVER PREDICTION PROMPT',
  prompt_version: 'fixture-v1',
  prediction_reasoning_effort: 'high',
  useThreadSample: false,
  disableMcp: false
}
const fixture = (t, { settings = {}, request, timeoutMs = 1_000 } = {}) => {
  const listeners = new Set()
  const stopped = new Set()
  const requests = []
  const published = []
  const client = {
    serverVersion: '0.166.0',
    onNotification: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onStopped: (listener) => {
      stopped.add(listener)
      return () => stopped.delete(listener)
    },
    request: async (method, params, options) => {
      requests.push({ method, params, options })
      const custom = request?.(method, params, options)
      if (custom !== undefined) return custom
      if (method === 'thread/prediction/request') throw unavailable()
      if (method === 'thread/resume') return { model: 'fixture-model', modelProvider: 'openai' }
      if (method === 'thread/fork') return { thread: { id: 'temporary' } }
      if (method === 'thread/sample') return { text: JSON.stringify({ suggestion: 'Add tests' }) }
      if (method === 'turn/start') {
        queueMicrotask(() => {
          emit('turn/started', { threadId: 'temporary', turn: { id: 'prediction' } })
          emit('item/completed', {
            threadId: 'temporary',
            turnId: 'prediction',
            item: { type: 'agentMessage', text: JSON.stringify({ suggestion: '  Add tests  ' }) }
          })
          emit('turn/completed', {
            threadId: 'temporary',
            turn: { id: 'prediction', status: 'completed' }
          })
        })
        return { turn: { id: 'prediction' } }
      }
      return {}
    }
  }
  const emit = (method, params) => {
    for (const listener of listeners) listener({ method, params })
  }
  const config = { load: async () => ({ ...defaults, ...settings }), clear() {} }
  const desktop = new CodexDesktopPredictions(client, (event) => published.push(event), {
    config,
    random: () => 0.5,
    timeoutMs
  })
  const service = new CodexPromptSuggestions(client, () => {}, desktop)
  t.after(() => service.dispose())
  return { client, desktop, service, emit, requests, published, stopped, config }
}

test('native support bypasses every compatibility/configuration call', async (t) => {
  const f = fixture(t, {
    request: (method) => (method === 'thread/prediction/request' ? {} : undefined)
  })
  f.config.load = () => {
    throw new Error('Compatibility must stay dormant')
  }
  await f.service.request('parent', 'source')
  assert.deepEqual(
    f.requests.map((r) => r.method),
    ['thread/prediction/request']
  )
  assert.deepEqual(f.published, [])
})

test('only method-unavailable negotiates compatibility; reconnect probes native again', async (t) => {
  const f = fixture(t)
  await f.service.request('parent', 'source')
  await f.service.request('parent', 'source')
  assert.equal(f.requests.filter((r) => r.method === 'thread/prediction/request').length, 1)
  assert.equal(f.requests.filter((r) => r.method === 'thread/fork').length, 1)
  for (const listener of f.stopped) listener(new Error('stopped'))
  f.client.request = async (method) => {
    f.requests.push({ method })
    return {}
  }
  await f.service.request('parent', 'new-source')
  assert.equal(f.requests.at(-1).method, 'thread/prediction/request')
})

test('auth, quota and transport errors never trigger compatibility inference', async (t) => {
  for (const code of [401, 429, -32603]) {
    const f = fixture(t, {
      request: () => Promise.reject(Object.assign(new Error('Native failure'), { code }))
    })
    await assert.rejects(f.service.request('parent', 'source'), /Native failure/)
    assert.deepEqual(
      f.requests.map((r) => r.method),
      ['thread/prediction/request']
    )
  }
})

test('Desktop default forks the parent with matching parameters, prompt and metadata, then cleans up', async (t) => {
  const f = fixture(t)
  await f.service.request('parent', 'source')
  assert.deepEqual(
    f.requests.map((r) => r.method),
    [
      'thread/prediction/request',
      'thread/resume',
      'thread/fork',
      'turn/start',
      'thread/unsubscribe'
    ]
  )
  const fork = f.requests.find((r) => r.method === 'thread/fork').params
  assert.deepEqual(fork, {
    threadId: 'parent',
    experimentalPredictionMode: true,
    config: { thread_unload_delay_secs: 10 },
    ephemeral: true,
    excludeTurns: true,
    threadSource: 'composer_predictions'
  })
  const turn = f.requests.find((r) => r.method === 'turn/start').params
  assert.equal(turn.threadId, 'temporary')
  assert.equal(turn.turnTrigger, 'composer_predictions')
  assert.equal(turn.effort, 'high')
  assert.equal(turn.outputSchema, null)
  assert.equal(turn.model, undefined, 'preserve inherited cache prefix/model')
  assert.deepEqual(turn.responsesapiClientMetadata, {
    prediction_source_thread_id: 'parent',
    prediction_source_turn_id: 'source',
    prediction_trigger: 'live'
  })
  const prefix = `${defaults.prompt}\n\nReturn only JSON matching this schema: `
  assert.ok(turn.input[0].text.startsWith(prefix))
  const schema = JSON.parse(turn.input[0].text.slice(prefix.length, -1))
  assert.deepEqual(schema.required, ['suggestion'])
  assert.deepEqual(schema.properties.suggestion.anyOf, [{ type: 'string' }, { type: 'null' }])
  assert.deepEqual(f.published[0].params, {
    threadId: 'parent',
    sourceTurnId: 'source',
    result: { type: 'completed', text: 'Add tests' }
  })
  assert.equal(f.desktop.isTemporaryThread('temporary'), true)
  f.emit('thread/closed', { threadId: 'temporary' })
  assert.equal(f.desktop.isTemporaryThread('temporary'), false)
})

test('Desktop feature flag selects thread/sample with exact source and prediction tags', async (t) => {
  const f = fixture(t, { settings: { useThreadSample: true, disableMcp: true } })
  await f.service.request('parent', 'source')
  assert.deepEqual(
    f.requests.map((r) => r.method),
    ['thread/prediction/request', 'thread/resume', 'thread/sample']
  )
  const sample = f.requests.at(-1).params
  assert.equal(sample.expectedTurnId, 'source')
  assert.equal(sample.threadSource, 'composer_predictions')
  assert.equal(sample.turnTrigger, 'composer_predictions')
  assert.equal(sample.disableMcp, true)
  assert.equal(sample.effort, 'high')
  assert.equal(f.published[0].params.result.text, 'Add tests')
})

test('disabled configs, server sampling, unsupported providers/models, Plan mode and old CLI skip generation', async (t) => {
  for (const reason of ['disabled', 'sampling', 'provider', 'model', 'plan', 'old-cli']) {
    const f = fixture(t, {
      settings: {
        ...(reason === 'disabled' ? { is_enabled: false } : {}),
        ...(reason === 'sampling' ? { live_sample_rate: 0 } : {}),
        ...(reason === 'model' ? { unsupported_models: ['fixture-model'] } : {})
      },
      request: (method) =>
        method === 'thread/resume'
          ? {
              model: 'fixture-model',
              modelProvider: reason === 'provider' ? 'custom' : 'openai',
              collaborationMode: { mode: reason === 'plan' ? 'plan' : 'default' }
            }
          : undefined
    })
    if (reason === 'old-cli') f.client.serverVersion = '0.162.0-alpha.19'
    await f.service.request('parent', 'source')
    assert.equal(
      f.requests.some((r) => ['thread/fork', 'thread/sample', 'turn/start'].includes(r.method)),
      false,
      reason
    )
    assert.equal(f.published[0].params.result.type, 'skipped')
  }
})

test('failed forks never fall back to a fresh conversation', async (t) => {
  const f = fixture(t, {
    request: (method) =>
      method === 'thread/fork' ? Promise.reject(new Error('fork failed')) : undefined
  })
  await assert.rejects(f.service.request('parent', 'source'), /fork failed/)
  assert.equal(
    f.requests.some((r) => r.method === 'thread/start'),
    false
  )
})

test('cancellation during native probing cannot start a late compatibility request', async (t) => {
  let fail
  const f = fixture(t, {
    request: (method) =>
      method === 'thread/prediction/request'
        ? new Promise((_, reject) => {
            fail = reject
          })
        : undefined
  })
  const pending = f.service.request('parent', 'source')
  f.service.cancel('parent')
  fail(unavailable())
  await pending
  assert.equal(f.requests.length, 1)
})

test('cancellation during fork creation reclaims its eventual ID without starting a turn', async (t) => {
  let finishFork
  const f = fixture(t, {
    request: (method) =>
      method === 'thread/fork'
        ? new Promise((resolve) => {
            finishFork = resolve
          })
        : undefined
  })
  const pending = f.service.request('parent', 'source')
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await tick()
  f.service.cancel('parent')
  finishFork({ thread: { id: 'temporary' } })
  await rejected
  assert.equal(f.requests.at(-1).method, 'thread/unsubscribe')
  assert.equal(
    f.requests.some((r) => r.method === 'turn/start'),
    false
  )
  assert.equal(f.published.length, 0)
})

test('a new source turn interrupts the hidden turn, cleans up and discards its result', async (t) => {
  const f = fixture(t, {
    request: (method) => (method === 'turn/start' ? { turn: { id: 'prediction' } } : undefined)
  })
  const pending = f.service.request('parent', 'source')
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await tick()
  f.emit('turn/started', { threadId: 'parent', turn: { id: 'next' } })
  await rejected
  assert.ok(
    f.requests.some((r) => r.method === 'turn/interrupt' && r.params.turnId === 'prediction')
  )
  assert.equal(f.requests.at(-1).method, 'thread/unsubscribe')
  assert.equal(f.published.length, 0)
})

test('prediction timeout interrupts and cleans up without publishing', async (t) => {
  const f = fixture(t, {
    timeoutMs: 20,
    request: (method) => (method === 'turn/start' ? { turn: { id: 'prediction' } } : undefined)
  })
  const pending = f.service.request('parent', 'source')
  await Promise.all([assert.rejects(pending, { name: 'TimeoutError' }), delay(40)])
  assert.equal(f.requests.at(-1).method, 'thread/unsubscribe')
  assert.equal(f.published.length, 0)
})

test('source-turn moderation policy suppresses labels and threshold matches', async (t) => {
  for (const side of ['prompt', 'generation', 'threshold']) {
    const f = fixture(t, {
      settings: {
        useThreadSample: true,
        safetyPolicy: { st: { test: 0.5 }, ubl: ['blocked-user'], abl: ['blocked-agent'] }
      }
    })
    f.emit('turn/moderationMetadata', {
      threadId: 'parent',
      turnId: 'source',
      metadata: {
        [side === 'generation' ? 'generation' : 'prompt']: {
          model: {
            outputs: [
              {
                results: [
                  {
                    labels: [
                      side === 'prompt'
                        ? 'blocked-user'
                        : side === 'generation'
                          ? 'blocked-agent'
                          : 'safe'
                    ],
                    _modapi_scores: { test: side === 'threshold' ? 0.7 : 0.1 }
                  }
                ]
              }
            ]
          }
        }
      }
    })
    await f.service.request('parent', 'source')
    assert.equal(f.published[0].params.result.type, 'skipped', side)
  }
})

const token = (accountId = 'account', userId = 'user') =>
  `header.${Buffer.from(
    JSON.stringify({
      exp: 9_999_999_999,
      'https://api.openai.com/auth': { chatgpt_account_id: accountId, user_id: userId }
    })
  ).toString('base64url')}.signature`
const configFixture = ({ config = {}, bootstrap, status = 200, authMethod = 'chatgpt' } = {}) => {
  const calls = []
  const auth = { authMethod, authToken: token() }
  const client = { request: async () => auth }
  let now = 0
  const service = new CodexDesktopPredictionConfig(client, {
    now: () => now,
    context: async () => ({
      app_version: 'sele-fixture',
      stable_id: 'own-installation',
      locale: 'en',
      system_name: 'Linux',
      system_version: 'fixture'
    }),
    fetch: async (url, options) => {
      calls.push({ url, options })
      return new Response(
        JSON.stringify(
          url.endsWith('/config')
            ? { ...defaults, ...config }
            : (bootstrap ?? {
                statsigPayload: JSON.stringify({
                  user: { userID: 'user', customIDs: { account_id: 'account' } }
                })
              })
        ),
        { status }
      )
    }
  })
  return {
    service,
    calls,
    auth,
    advance: () => {
      now += 300_001
    }
  }
}

test('configuration uses authenticated Desktop endpoints and account-scoped five-minute caching', async () => {
  const f = configFixture()
  const signal = new AbortController().signal
  await f.service.load(signal)
  await f.service.load(signal)
  assert.equal(f.calls.length, 2)
  assert.deepEqual(
    f.calls.map((r) => r.url),
    [
      'https://chatgpt.com/backend-api/wham/predictions/config',
      'https://chatgpt.com/backend-api/wham/statsig/bootstrap'
    ]
  )
  const request = f.calls[1].options
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.Authorization, `Bearer ${token()}`)
  assert.equal(request.headers['ChatGPT-Account-Id'], 'account')
  assert.equal(request.headers.originator, 'Codex Desktop')
  assert.equal(request.redirect, 'error')
  assert.equal(JSON.parse(request.body).app_version, 'sele-fixture')
  f.advance()
  await f.service.load(signal)
  assert.equal(f.calls.length, 4)
  f.auth.authToken = token('other-account')
  await f.service.load(signal)
  assert.equal(f.calls.length, 6)
  assert.equal(f.calls[4].options.headers['ChatGPT-Account-Id'], 'other-account')
})

test('server bootstrap gates and moderation policy are read from hashed Statsig keys', async () => {
  const hash = (name) =>
    String([...name].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) | 0, 0) >>> 0)
  const f = configFixture({
    bootstrap: {
      statsigPayload: JSON.stringify({
        user: { userID: 'user', customIDs: { account_id: 'account' } },
        feature_gates: {
          [hash('codex-app-cumberbatch-thread-sample')]: { value: true },
          [hash('codex-app-cumberbatch-disable-mcp')]: { value: true }
        },
        dynamic_configs: {
          [hash('codex-app-cumberbatch-mod-policy')]: {
            value: { st: { test: 0.9 }, ubl: ['label'] }
          }
        }
      })
    }
  })
  const settings = await f.service.load(new AbortController().signal)
  assert.equal(settings.useThreadSample, true)
  assert.equal(settings.disableMcp, true)
  assert.deepEqual(settings.safetyPolicy, { st: { test: 0.9 }, ubl: ['label'] })
})

test('disabled/invalid/unavailable configs and API keys cannot invoke inference or invent a prompt', async () => {
  for (const options of [
    { config: { is_enabled: false } },
    { config: { prompt: null } },
    { status: 403 },
    { authMethod: 'apikey' }
  ]) {
    const f = configFixture(options)
    assert.equal(await f.service.load(new AbortController().signal), null)
    assert.equal(
      f.calls.some((r) => r.url.endsWith('/bootstrap')),
      false
    )
  }
})

test('bootstrap from a different principal cannot enable flags or supply a policy', async () => {
  const f = configFixture({
    bootstrap: {
      statsigPayload: JSON.stringify({
        user: { userID: 'other-user', customIDs: { account_id: 'account' } },
        feature_gates: { 'codex-app-cumberbatch-thread-sample': { value: true } },
        dynamic_configs: { 'codex-app-cumberbatch-mod-policy': { value: { ubl: ['label'] } } }
      })
    }
  })
  const settings = await f.service.load(new AbortController().signal)
  assert.equal(settings.useThreadSample, false)
  assert.equal(settings.safetyPolicy, undefined)
})

test('account changes cancel prediction work and clear account configuration', async (t) => {
  const f = fixture(t, {
    request: (method) => (method === 'turn/start' ? { turn: { id: 'prediction' } } : undefined)
  })
  let cleared = 0
  f.config.clear = () => {
    cleared++
  }
  const pending = f.service.request('parent', 'source')
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await tick()
  f.emit('account/updated', { authMode: 'chatgpt' })
  await rejected
  assert.equal(cleared, 1)
  assert.equal(f.published.length, 0)
  assert.equal(f.requests.at(-1).method, 'thread/unsubscribe')
})

test('failed, interrupted, malformed and null prediction results cannot become suggestions', async (t) => {
  for (const value of [
    'not json',
    JSON.stringify({ suggestion: null }),
    JSON.stringify({ suggestion: 1 })
  ]) {
    const f = fixture(t, {
      settings: { useThreadSample: true },
      request: (method) => (method === 'thread/sample' ? { text: value } : undefined)
    })
    if (value === JSON.stringify({ suggestion: null })) {
      await f.service.request('parent', 'source')
      assert.equal(f.published[0].params.result.type, 'skipped')
    } else {
      await assert.rejects(f.service.request('parent', 'source'))
      assert.equal(f.published.length, 0)
    }
  }
  for (const status of ['failed', 'interrupted']) {
    const f = fixture(t, {
      request: (method) => (method === 'turn/start' ? { turn: { id: 'prediction' } } : undefined)
    })
    const pending = f.service.request('parent', 'source')
    const rejected = assert.rejects(pending, /Prediction turn failed/)
    await tick()
    f.emit('turn/completed', { threadId: 'temporary', turn: { id: 'prediction', status } })
    await rejected
    assert.equal(f.requests.at(-1).method, 'thread/unsubscribe')
    assert.equal(f.published.length, 0)
  }
})

test('unauthorized configuration refreshes once without crossing principals', async () => {
  for (const changedPrincipal of [false, true]) {
    let authCalls = 0
    let httpCalls = 0
    const authArgs = []
    const service = new CodexDesktopPredictionConfig(
      {
        request: async (_method, args) => {
          authArgs.push(args)
          authCalls++
          return {
            authMethod: 'chatgpt',
            authToken: token(changedPrincipal && authCalls > 1 ? 'new-account' : 'account')
          }
        }
      },
      {
        fetch: async () => {
          httpCalls++
          return new Response(
            JSON.stringify(httpCalls === 1 ? {} : { ...defaults, is_enabled: false }),
            { status: httpCalls === 1 ? 401 : 200 }
          )
        }
      }
    )
    assert.equal(await service.load(new AbortController().signal), null)
    assert.deepEqual(
      authArgs.map((args) => args.refreshToken),
      [false, true]
    )
    assert.equal(httpCalls, changedPrincipal ? 1 : 2)
  }
})
