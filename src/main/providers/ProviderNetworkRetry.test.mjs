import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isTransientNetworkFailure,
  networkRetryPrompt,
  withProviderNetworkRetries
} from './ProviderNetworkRetry.ts'

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
const options = {
  model: 'chosen-model',
  reasoningEffort: 'high',
  serviceTier: 'fast',
  approvalPolicy: 'never',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write',
  cwd: '/workspace',
  container: { type: 'ssh', id: 'remote' },
  files: [{ path: 'file' }],
  images: [{ url: 'image' }],
  skills: [{ path: 'skill' }],
  review: { id: 'review' }
}

const fixture = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let listener
  let revision = 0
  let current = { id: 'chat', status: 'active', revision: revision++, items: [] }
  const calls = []
  const updates = []
  const emit = (detail, terminal = false) => {
    current = { ...detail, revision: revision++ }
    listener(current, { turnCompleted: terminal })
  }
  const native = {
    id: 'codex',
    onChatUpdated: (fn) => {
      listener = fn
      return () => {
        listener = () => {}
      }
    },
    continueChat: async (id, message, settings) => {
      calls.push({ id, message, settings })
      emit({ id, status: 'active', items: [] })
      return current
    },
    startChat: async (message, settings, onCreated) => {
      await onCreated?.('chat')
      return native.continueChat('chat', message, settings)
    },
    continueChatInFork: async (id, message, settings, onCreated) => {
      await onCreated?.('fork')
      return native.continueChat('fork', message, settings)
    },
    sendActiveChatMessage: async () => {
      throw new Error('unexpected active send')
    },
    getChat: async () => current,
    getChatWindow: async () => current,
    getChats: async () => ({ chats: [{ id: 'chat', status: current.status }], nextCursor: null }),
    stopChat: async () => {
      emit({ ...current, status: null })
      return current
    },
    dispose: () => {}
  }
  const adapter = withProviderNetworkRetries(native)
  adapter.onChatUpdated((detail, metadata) => updates.push({ detail, metadata }))
  t.after(() => adapter.dispose())
  const fail = (
    id = 'turn-1',
    message = 'stream disconnected before completion: ECONNRESET',
    extra = {}
  ) =>
    emit(
      {
        id: current.id,
        status: 'error',
        items: [{ type: 'working', id, status: 'failed', failureMessage: message, items: [] }],
        ...extra
      },
      true
    )
  return { adapter, native, calls, updates, fail, emit }
}

test('recognizes transient transport failures and rejects permanent failures', () => {
  for (const message of [
    'fetch failed',
    'Connection error.',
    'ConnectionError',
    'failed to connect to model provider',
    'EAI_AGAIN',
    'request timed out',
    'HTTP 503 Service Unavailable',
    'network_error',
    'The connection to the model provider was interrupted.',
    'Claude disconnected before completing the turn.'
  ]) {
    assert.equal(isTransientNetworkFailure(message), true, message)
  }
  for (const message of [
    'HTTP 401: network error',
    'rate limit exceeded: 503',
    'quota exceeded',
    'Invalid API key',
    'certificate error',
    'ENOTFOUND',
    'tool execution failed',
    'command timed out',
    'context length exceeded'
  ]) {
    assert.equal(isTransientNetworkFailure(message), false, message)
  }
})

test('resumes a confirmed failure after backoff with settings but without duplicate attachments', async (t) => {
  const { adapter, calls, updates, fail } = fixture(t)
  await adapter.startChat('do the task', options)
  fail()
  assert.equal(updates.at(-1).detail.status, 'active')
  assert.equal(updates.at(-1).metadata.turnCompleted, false)
  assert.match(updates.at(-1).detail.items[0].failureMessage, /Retrying in 2s \(1\/10\)/)
  assert.equal((await adapter.getChat('chat')).status, 'active')
  assert.equal((await adapter.getChatWindow('chat', {})).status, 'active')
  assert.equal((await adapter.getChats()).chats[0].status, 'active')
  t.mock.timers.tick(1999)
  await flush()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  await flush()
  assert.equal(calls.length, 2)
  assert.equal(calls[1].message, networkRetryPrompt)
  assert.deepEqual(calls[1].settings, {
    ...options,
    files: undefined,
    images: undefined,
    skills: undefined,
    review: undefined
  })
})

test('defaults to ten retries at a fixed two-second interval and deduplicates terminal notifications', async (t) => {
  const { adapter, calls, updates, fail } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  for (let index = 0; index < 10; index++) {
    const delay = 2000
    fail(`turn-${index}`)
    fail(`turn-${index}`)
    assert.match(updates.at(-1).detail.items[0].failureMessage, new RegExp(`\\(${index + 1}/10\\)`))
    t.mock.timers.tick(delay - 1)
    await flush()
    assert.equal(calls.length, index + 1)
    t.mock.timers.tick(1)
    await flush()
    assert.equal(calls.length, index + 2)
  }
  fail('last-turn')
  assert.equal(updates.at(-1).detail.status, 'error')
  assert.equal(updates.at(-1).metadata.turnCompleted, true)
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 11)
})

test('Stop cancels a pending retry', async (t) => {
  const { adapter, calls, fail } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  await adapter.stopChat('chat')
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 1)
})

test('a new message replaces the pending retry and starts normally despite the active UI status', async (t) => {
  const { adapter, calls, fail } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  await adapter.sendActiveChatMessage('chat', 'different task', 'queue', options)
  t.mock.timers.tick(60000)
  await flush()
  assert.deepEqual(
    calls.map((call) => call.message),
    ['task', 'different task']
  )
})

test('native activity or queued work cancels backoff', async (t) => {
  const { adapter, calls, fail, emit } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  emit({ id: 'chat', status: 'active', items: [] })
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 1)
})

test('does not retry old history, nonterminal errors, permanent errors, or blocked chats', async (t) => {
  const { adapter, calls, fail, emit } = fixture(t)
  fail()
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 0)
  for (const [message, extra] of [
    ['HTTP 401 network error', {}],
    ['ECONNRESET', { writeAccess: 'readOnly' }],
    ['ECONNRESET', { pendingApproval: { id: 'approval' } }],
    ['ECONNRESET', { pendingUserInput: { id: 'question' } }],
    ['ECONNRESET', { items: [{ type: 'pendingMessage', id: 'queued' }] }]
  ]) {
    await adapter.continueChat('chat', 'task', options)
    fail('failed', message, extra)
    t.mock.timers.tick(60000)
    await flush()
  }
  await adapter.continueChat('chat', 'task', options)
  emit({
    id: 'chat',
    status: 'error',
    items: [{ type: 'working', id: 'failed', status: 'failed', failureMessage: 'ECONNRESET' }]
  })
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 6)
})

test('rechecks the failed turn before submitting a retry', async (t) => {
  const { adapter, native, calls, fail } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  native.getChatWindow = async () => ({ id: 'chat', status: null, revision: 100, items: [] })
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(calls.length, 1)
  assert.equal((await adapter.getChat('chat')).status, 'error')
})

test('Stop during the asynchronous recheck prevents submission', async (t) => {
  const { adapter, native, calls, fail } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  let release
  native.getChatWindow = () =>
    new Promise((resolve) => {
      release = resolve
    })
  t.mock.timers.tick(2000)
  await flush()
  await adapter.stopChat('chat')
  release({
    id: 'chat',
    status: 'error',
    items: [{ type: 'working', id: 'turn-1', status: 'failed', failureMessage: 'ECONNRESET' }]
  })
  await flush()
  assert.equal(calls.length, 1)
})

test('a rejected retry submission is reported without blindly resending', async (t) => {
  const { adapter, native, calls, fail, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  native.continueChat = async () => {
    calls.push({ message: 'retry' })
    throw new Error('ECONNRESET')
  }
  const logged = t.mock.method(console, 'error', () => {})
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(logged.mock.callCount(), 1)
  assert.equal(updates.at(-1).detail.status, 'error')
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 2)
})

test('dispose clears scheduled retries and subscriptions', async (t) => {
  const { adapter, calls, fail, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  adapter.dispose()
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 1)
  const count = updates.length
  fail()
  assert.equal(updates.length, count)
})

test('a successful turn resets the retry budget for the next user task', async (t) => {
  const { adapter, calls, fail, emit, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  t.mock.timers.tick(2000)
  await flush()
  emit({ id: 'chat', status: null, items: [] }, true)
  await adapter.continueChat('chat', 'next task', options)
  fail('next-failure')
  assert.match(updates.at(-1).detail.items[0].failureMessage, /\(1\/10\)/)
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(calls.length, 4)
})

test('retries failed Codex turns even when the native thread has returned to idle', async (t) => {
  const { adapter, calls, fail, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail('failed-codex', 'stream disconnected before completion', { status: null })
  fail('failed-codex', 'stream disconnected before completion', { status: null })
  assert.equal(updates.at(-1).detail.status, 'active')
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(calls.length, 2)
})

test('does not retry a rejected initial submission even after the chat was created', async (t) => {
  const { adapter, native, calls, fail } = fixture(t)
  native.startChat = async (message, settings, onCreated) => {
    await onCreated('chat')
    throw new Error('fetch failed')
  }
  await assert.rejects(adapter.startChat('task', options), /fetch failed/)
  fail()
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 0)
})

test('preserves fork creation callbacks and retries in the fork', async (t) => {
  const { adapter, calls, fail } = fixture(t)
  const created = []
  await adapter.continueChatInFork('chat', 'task', options, async (id) => {
    created.push(id)
  })
  fail()
  t.mock.timers.tick(2000)
  await flush()
  assert.deepEqual(created, ['fork'])
  assert.equal(calls[1].id, 'fork')
  assert.equal(calls[1].message, networkRetryPrompt)
})

test('retries are scoped to each chat and stopping one leaves the other scheduled', async (t) => {
  const { adapter, native, calls, emit } = fixture(t)
  const failures = new Map(
    ['first', 'second'].map((id) => [
      id,
      {
        id,
        status: 'error',
        revision: 10,
        items: [
          {
            type: 'working',
            id: `${id}-failed`,
            status: 'failed',
            failureMessage: 'Connection error.',
            items: []
          }
        ]
      }
    ])
  )
  native.getChatWindow = async (id) => failures.get(id)
  for (const id of failures.keys()) {
    await adapter.continueChat(id, 'task', options)
    emit(failures.get(id), true)
  }
  await adapter.stopChat('first')
  t.mock.timers.tick(2000)
  await flush()
  assert.deepEqual(
    calls.filter((call) => call.message === networkRetryPrompt).map((call) => call.id),
    ['second']
  )
})

test('publishes the final failure if the provider is unreachable and preserves future revisions', async (t) => {
  const { adapter, native, calls, fail, emit, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  const failure = { ...updates.at(-1).detail, status: 'error' }
  native.getChatWindow = async () => {
    throw new Error('ECONNRESET')
  }
  native.getChat = async () => {
    throw new Error('ECONNRESET')
  }
  const logged = t.mock.method(console, 'error', () => {})
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(logged.mock.callCount(), 2)
  assert.equal(updates.at(-1).detail.status, 'error')
  assert.equal(updates.at(-1).metadata.turnCompleted, true)
  assert.ok(updates.at(-1).detail.revision > failure.revision)
  const finalRevision = updates.at(-1).detail.revision
  emit({ id: 'chat', status: 'active', items: [] })
  assert.ok(updates.at(-1).detail.revision > finalRevision)
})

test('a rejected retry that emitted activity still clears the retry UI when refresh also fails', async (t) => {
  const { adapter, native, emit, fail, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', options)
  fail()
  native.continueChat = async () => {
    emit({ id: 'chat', status: 'active', items: [] })
    throw new Error('ECONNRESET')
  }
  native.getChat = async () => {
    throw new Error('ECONNRESET')
  }
  t.mock.method(console, 'error', () => {})
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(updates.at(-1).detail.status, 'error')
  assert.ok(updates.at(-1).detail.revision > updates.at(-2).detail.revision)
})

test('uses the configured retry count and fixed interval', async (t) => {
  const { adapter, calls, fail, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', {
    ...options,
    networkRetry: { count: 2, delaySeconds: 0.5 }
  })
  for (let i = 0; i < 2; i++) {
    fail(`custom-${i}`)
    assert.match(updates.at(-1).detail.items[0].failureMessage, /Retrying in 0.5s/)
    t.mock.timers.tick(499)
    await flush()
    assert.equal(calls.length, i + 1)
    t.mock.timers.tick(1)
    await flush()
    assert.equal(calls.length, i + 2)
  }
  fail('exhausted')
  assert.equal(updates.at(-1).detail.status, 'error')
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 3)
})

test('zero retry attempts disables automatic retries', async (t) => {
  const { adapter, calls, fail, updates } = fixture(t)
  await adapter.continueChat('chat', 'task', {
    ...options,
    networkRetry: { count: 0, delaySeconds: 2 }
  })
  fail()
  assert.equal(updates.at(-1).detail.status, 'error')
  assert.equal(updates.at(-1).metadata.turnCompleted, true)
  t.mock.timers.tick(60000)
  await flush()
  assert.equal(calls.length, 1)
})
