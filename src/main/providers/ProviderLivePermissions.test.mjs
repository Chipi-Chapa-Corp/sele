import assert from 'node:assert/strict'
import test from 'node:test'
import { withLiveChatPermissions } from './ProviderLivePermissions.ts'

const ask = {
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
  sandboxMode: 'workspace-write'
}
const allow = { ...ask, approvalPolicy: 'never' }
const full = { ...ask, sandboxMode: 'danger-full-access' }
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const fixture = (nativeUpdate) => {
  let listener
  let revision = 0
  const details = new Map()
  const replies = []
  const updates = []
  const makeDetail = (id, pendingApproval = null, pendingUserInput = null) => ({
    id,
    revision: ++revision,
    items: [],
    pendingApproval,
    pendingUserInput,
    status: pendingApproval
      ? 'waitingOnApproval'
      : pendingUserInput
        ? 'waitingOnUserInput'
        : 'active'
  })
  const native = {
    id: 'opencode',
    onChatUpdated: (callback) => {
      listener = callback
      return () => {
        listener = null
      }
    },
    getChat: async (id) => details.get(id) ?? makeDetail(id),
    resolveApproval: async (id, decision) => {
      replies.push([id, details.get(id)?.pendingApproval?.id, decision])
      const detail = makeDetail(id)
      details.set(id, detail)
      listener(detail)
      return detail
    },
    updateChatPermissions: nativeUpdate,
    continueChat: async (id) => details.get(id),
    stopChat: async (id) => makeDetail(id),
    dispose() {}
  }
  const adapter = withLiveChatPermissions(native)
  const unsubscribe = adapter.onChatUpdated((detail) => updates.push(detail))
  const emit = (id, requestId, question = null) => {
    const detail = makeDetail(id, requestId ? { id: requestId, type: 'command' } : null, question)
    details.set(id, detail)
    listener?.(detail)
    return detail
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  return { adapter, native, details, emit, replies, updates, flush, unsubscribe }
}

test('Allow all approves a pending request and later requests without native live support', async () => {
  const f = fixture()
  f.emit('chat', 'first')
  await f.adapter.updateChatPermissions('chat', allow)
  assert.deepEqual(f.replies, [['chat', 'first', 'allow']])
  f.unsubscribe() // Moving away from the chat must not disable host approvals.
  f.emit('chat', 'second')
  await f.flush()
  assert.deepEqual(f.replies, [
    ['chat', 'first', 'allow'],
    ['chat', 'second', 'allow']
  ])
  f.adapter.dispose()
})

test('Full access takes effect while a native permission update is still in flight', async () => {
  const gate = deferred()
  const calls = []
  const f = fixture(async (...args) => {
    calls.push(args)
    await gate.promise
  })
  f.emit('chat', 'pending')
  const updating = f.adapter.updateChatPermissions('chat', full)
  await f.flush()
  assert.deepEqual(f.replies, [['chat', 'pending', 'allow']])
  assert.equal(calls[0][0], 'chat')
  assert.equal(calls[0][1].sandboxMode, 'danger-full-access')
  gate.resolve()
  await updating
  f.adapter.dispose()
})

test('a rejected native update falls back to host approvals', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture(async () => {
    throw new Error('not supported while busy')
  })
  await f.adapter.updateChatPermissions('chat', allow)
  f.emit('chat', 'later')
  await f.flush()
  assert.deepEqual(f.replies, [['chat', 'later', 'allow']])
  f.adapter.dispose()
})

test('auto-approval drains multiple requests returned by the provider', async () => {
  const f = fixture()
  f.emit('chat', 'first')
  const original = f.native.resolveApproval
  f.native.resolveApproval = async (id, decision) => {
    const result = await original(id, decision)
    return f.replies.length === 1 ? f.emit(id, 'second') : result
  }
  await f.adapter.updateChatPermissions('chat', allow)
  assert.deepEqual(
    f.replies.map((reply) => reply[1]),
    ['first', 'second']
  )
  f.adapter.dispose()
})

test('duplicate events do not approve the same request twice', async () => {
  const f = fixture()
  await f.adapter.updateChatPermissions('chat', allow)
  const gate = deferred()
  f.native.resolveApproval = async (id, decision) => {
    f.replies.push([id, 'duplicate', decision])
    await gate.promise
    return f.details.get(id)
  }
  f.emit('chat', 'duplicate')
  await f.flush()
  f.emit('chat', 'duplicate')
  gate.resolve()
  await f.flush()
  assert.equal(f.replies.length, 1)
  f.emit('chat', 'duplicate')
  await f.flush()
  assert.equal(f.replies.length, 1)
  f.adapter.dispose()
})

test('switching back to Ask stops automatic replies, including during a pending reply', async () => {
  const f = fixture()
  await f.adapter.updateChatPermissions('chat', allow)
  const gate = deferred()
  const original = f.native.resolveApproval
  f.native.resolveApproval = async (...args) => {
    await gate.promise
    const result = await original(...args)
    return f.emit('chat', 'next')
  }
  f.emit('chat', 'first')
  await f.flush()
  const updating = f.adapter.updateChatPermissions('chat', ask)
  gate.resolve()
  await updating
  await f.flush()
  assert.deepEqual(
    f.replies.map((reply) => reply[1]),
    ['first']
  )
  assert.equal(f.updates.at(-1).pendingApproval.id, 'next')
  f.adapter.dispose()
})

test('permission choices are scoped to the chat and do not answer user questions', async () => {
  const f = fixture()
  await f.adapter.updateChatPermissions('allowed', allow)
  f.emit('other', 'needs-review')
  f.emit('allowed', null, { id: 'question' })
  await f.flush()
  assert.deepEqual(f.replies, [])
  assert.equal(f.updates.at(-1).pendingUserInput.id, 'question')
  await f.adapter.updateChatPermissions('readonly', { ...allow, sandboxMode: 'read-only' })
  f.emit('readonly', 'write')
  await f.flush()
  assert.deepEqual(f.replies, [])
  f.adapter.dispose()
})

test('failed automatic replies stay visible and do not spin', async (t) => {
  t.mock.method(console, 'error', () => {})
  const f = fixture()
  f.native.resolveApproval = async () => {
    f.replies.push('attempt')
    throw new Error('reply failed')
  }
  await f.adapter.updateChatPermissions('chat', allow)
  f.emit('chat', 'pending')
  await f.flush()
  f.emit('chat', 'pending')
  await f.flush()
  assert.equal(f.replies.length, 1)
  assert.equal(f.updates.at(-1).pendingApproval.id, 'pending')
  f.adapter.dispose()
})

test('stopping a chat disables host auto-approval', async () => {
  const f = fixture()
  await f.adapter.updateChatPermissions('chat', allow)
  await f.adapter.stopChat('chat')
  f.emit('chat', 'late')
  await f.flush()
  assert.deepEqual(f.replies, [])
  f.adapter.dispose()
})
