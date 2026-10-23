import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { PendingMessageEdits } from './PendingMessageEdits.ts'
import { PersistentPendingMessages } from './PersistentPendingMessages.ts'

// Run each adapter's real restore/persist methods against the real store and a memory backend.
const createAdapter = (
  path,
  className,
  methodNames,
  helperNames = [],
  fields = '',
  globals = {}
) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === className
  )
  const methods = methodNames.map((name) => {
    const member = declaration.members.find((node) => node.name?.getText(source) === name)
    assert.ok(member, `${className}.${name} exists`)
    return member.getText(source)
  })
  const helpers = source.statements.filter(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((entry) =>
        helperNames.includes(entry.name.getText(source))
      )
  )
  return vm.runInNewContext(
    ts.transpile(
      `${helpers.map((node) => node.getText(source)).join('\n')}
      class Adapter { ${fields}
      ${methods.join('\n')} }; new Adapter()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    { PendingMessageEdits, console, ...globals }
  )
}

// Values built inside the VM context have its prototypes; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value))

const memoryStore = (providerId, chatId, stored) => {
  const rows = new Map([[chatId, stored]])
  const store = new PersistentPendingMessages(providerId, {
    read: async (_provider, chat) =>
      (rows.get(chat) ?? []).map((row) => ({
        createdAt: 1,
        submitted: false,
        kind: 'queued',
        ...row,
        payload: JSON.stringify(row.payload)
      })),
    replace: async (_provider, chat, next) => {
      rows.set(
        chat,
        next.map((row) => ({ ...row, payload: JSON.parse(row.payload) }))
      )
    }
  })
  return {
    store,
    rows: async () => {
      await store.flush()
      return rows.get(chatId)
    }
  }
}

test('Claude restores undelivered steering ahead of the paused queue', async () => {
  const memory = memoryStore('claude', 'chat', [
    { id: 'folded', kind: 'steering', submitted: true, payload: { content: 'Folded in' } },
    { id: 'lost', kind: 'steering', submitted: true, payload: { content: 'Never reached' } },
    { id: 'queued', payload: { content: 'Next', prompt: 'Next', attachments: [] } }
  ])
  const adapter = createAdapter('./claude/ClaudeProviderAdapter.ts', 'ClaudeProviderAdapter', [
    'restorePendingMessages',
    'persistPendingMessages'
  ])
  adapter.pendingMessageStore = memory.store
  const state = {
    id: 'chat',
    queuedMessages: [],
    submittedSteering: [],
    queuedMessagesPaused: false
  }
  adapter.restorePendingMessages(state, await memory.store.restore('chat'), ['folded'])
  adapter.persistPendingMessages(state)

  assert.deepEqual(
    plain(state.queuedMessages.map((message) => [message.id, message.kind, message.content])),
    [
      ['lost', 'steering', 'Never reached'],
      ['queued', 'queued', 'Next']
    ]
  )
  assert.equal(state.queuedMessagesPaused, true)
  assert.deepEqual(plain((await memory.rows()).map((row) => [row.id, row.kind, row.submitted])), [
    ['lost', 'steering', false],
    ['queued', 'queued', false]
  ])
})

test('Claude stores steering handed to Claude Code until it is consumed', async () => {
  const memory = memoryStore('claude', 'chat', [])
  const adapter = createAdapter(
    './claude/ClaudeProviderAdapter.ts',
    'ClaudeProviderAdapter',
    ['steerWithMessage', 'pushSteering', 'persistPendingMessages'],
    ['createSdkUserMessage']
  )
  adapter.pendingMessageStore = memory.store
  await memory.store.restore('chat')
  const pushed = []
  adapter.addUserMessage = () => {}
  const queued = { id: 'queued', content: 'Later', prompt: 'Later', createdAt: 2 }
  const state = {
    id: 'chat',
    queuedMessages: [queued],
    submittedSteering: [],
    deferredSteering: [],
    turnAwaitingStart: false,
    input: { push: (message) => pushed.push(message) }
  }
  adapter.steerWithMessage(state, { id: 'steer', content: 'Now', prompt: 'Now', createdAt: 1 })
  adapter.persistPendingMessages(state)

  assert.deepEqual(plain(pushed.map((message) => [message.uuid, message.priority])), [
    ['steer', 'now']
  ])
  assert.deepEqual(plain((await memory.rows()).map((row) => [row.id, row.kind, row.submitted])), [
    ['steer', 'steering', true],
    ['queued', 'queued', false]
  ])
})

test('Codex restores steering Codex never recorded as a paused queued turn', async () => {
  const memory = memoryStore('codex', 'thread', [
    {
      id: 'echoed',
      kind: 'steering',
      submitted: true,
      payload: { itemId: 'client-echoed', text: 'Already in the turn', status: 'pending' }
    },
    {
      id: 'accepted',
      kind: 'steering',
      submitted: true,
      payload: { itemId: 'client-accepted', text: 'Accepted, then lost', status: 'pending' }
    },
    {
      id: 'held',
      kind: 'steering',
      payload: { itemId: 'client-held', text: 'Held by an edit', status: 'waiting' }
    },
    { id: 'queued', payload: { text: 'Next', options: { model: 'gpt' } } }
  ])
  const adapter = createAdapter(
    './codex/CodexProviderAdapter.ts',
    'CodexProviderAdapter',
    ['applyRestoredPendingMessages', 'persistPendingMessages'],
    ['getOptionalStringValue', 'getCodexUserMessageClientId'],
    `threads = new Map(); queuedTurnsByThread = new Map(); steeringMessagesByThread = new Map();
    hiddenPendingMessageIdsByThread = new Map(); pausedQueuedTurnThreads = new Set();`
  )
  adapter.pendingMessageStore = memory.store
  const updates = []
  adapter.scheduleChatUpdated = (threadId) => updates.push(threadId)
  adapter.threads.set('thread', {
    id: 'thread',
    turns: [{ id: 'turn', items: [{ type: 'userMessage', id: 'item', clientId: 'client-echoed' }] }]
  })
  adapter.queuedTurnsByThread.set('thread', [{ id: 'new', text: 'Sent after restart' }])

  adapter.applyRestoredPendingMessages('thread', await memory.store.restore('thread'))

  assert.deepEqual(
    plain(adapter.queuedTurnsByThread.get('thread').map((turn) => [turn.id, turn.kind, turn.text])),
    [
      ['accepted', 'steering', 'Accepted, then lost'],
      ['held', 'steering', 'Held by an edit'],
      ['queued', null, 'Next'],
      ['new', null, 'Sent after restart']
    ]
  )
  assert.equal(adapter.queuedTurnsByThread.get('thread')[2].options.model, 'gpt')
  assert.ok(adapter.pausedQueuedTurnThreads.has('thread'))
  assert.deepEqual(updates, ['thread'])
  assert.deepEqual(plain((await memory.rows()).map((row) => [row.id, row.kind, row.submitted])), [
    ['accepted', 'steering', false],
    ['held', 'steering', false],
    ['queued', 'queued', false],
    ['new', 'queued', false]
  ])
})

test('Codex stores accepted steering as submitted until Codex echoes it', async () => {
  const memory = memoryStore('codex', 'thread', [])
  const adapter = createAdapter(
    './codex/CodexProviderAdapter.ts',
    'CodexProviderAdapter',
    ['persistPendingMessages'],
    [],
    `queuedTurnsByThread = new Map(); steeringMessagesByThread = new Map();
    hiddenPendingMessageIdsByThread = new Map();`
  )
  adapter.pendingMessageStore = memory.store
  await memory.store.restore('thread')
  adapter.steeringMessagesByThread.set('thread', [
    { id: 'waiting', status: 'waiting', createdAt: 1 },
    { id: 'pending', status: 'pending', createdAt: 2 },
    { id: 'sent', status: 'sent', createdAt: 3 }
  ])
  adapter.persistPendingMessages('thread')
  assert.deepEqual(plain((await memory.rows()).map((row) => [row.id, row.submitted])), [
    ['waiting', false],
    ['pending', true]
  ])
})

test('Copilot restores steering its session never recorded and pauses the queue', async () => {
  const memory = memoryStore('copilot', 'session', [
    {
      id: 'recorded',
      kind: 'steering',
      submitted: true,
      createdAt: Date.parse('2026-10-22T10:00:00Z'),
      payload: { type: 'pendingMessage', content: 'Use the cache', delivery: 'provider' }
    },
    {
      id: 'repeated',
      kind: 'steering',
      submitted: true,
      createdAt: Date.parse('2026-10-22T11:00:00Z'),
      // The same words sent an hour earlier do not prove this steer arrived.
      payload: { type: 'pendingMessage', content: 'Continue', delivery: 'provider' }
    },
    { id: 'queued', payload: { type: 'pendingMessage', content: 'Next', delivery: 'local' } }
  ])
  const adapter = createAdapter(
    './copilot/CopilotProviderAdapter.ts',
    'CopilotProviderAdapter',
    ['restorePendingMessages', 'persistPendingMessages'],
    ['toMilliseconds', 'restoredMessageClockSkewMs']
  )
  adapter.pendingMessageStore = memory.store
  const state = {
    id: 'session',
    queuePaused: false,
    pendingMessages: [],
    events: [
      {
        type: 'user.message',
        timestamp: '2026-10-22T10:00:01Z',
        data: { content: 'Use the cache' }
      },
      { type: 'user.message', timestamp: '2026-10-22T10:00:00Z', data: { content: 'Continue' } }
    ]
  }
  adapter.restorePendingMessages(state, await memory.store.restore('session'))

  assert.deepEqual(
    plain(state.pendingMessages.map((message) => [message.id, message.kind, message.delivery])),
    [
      ['repeated', 'steering', 'local'],
      ['queued', 'queued', 'local']
    ]
  )
  assert.equal(state.queuePaused, true)
  assert.deepEqual(plain((await memory.rows()).map((row) => [row.id, row.submitted])), [
    ['repeated', false],
    ['queued', false]
  ])
})

test('OpenCode restores its queue paused and does not send it on the next drain', async () => {
  const memory = memoryStore('opencode', 'session', [
    { id: 'steer', kind: 'steering', payload: { type: 'pendingMessage', content: 'Steer' } },
    { id: 'queued', payload: { type: 'pendingMessage', content: 'Next' } }
  ])
  const adapter = createAdapter(
    './opencode/OpenCodeProviderAdapter.ts',
    'OpenCodeProviderAdapter',
    ['restorePendingMessages', 'persistPendingMessages', 'drainQueue'],
    [],
    'queueDrains = new Set(); pendingMessageEdits = new PendingMessageEdits();'
  )
  adapter.pendingMessageStore = memory.store
  adapter.scheduleUpdate = () => {}
  adapter.sendPrompt = () => assert.fail('a restored queue waits for the user')
  const state = {
    id: 'session',
    active: false,
    stopped: false,
    usageLimitReached: false,
    queuePaused: false,
    queuedMessages: []
  }
  adapter.restorePendingMessages(state, await memory.store.restore('session'))
  await adapter.drainQueue(state)

  assert.deepEqual(plain(state.queuedMessages.map((message) => [message.id, message.kind])), [
    ['steer', 'steering'],
    ['queued', 'queued']
  ])
  assert.equal(state.queuePaused, true)
  assert.deepEqual(plain((await memory.rows()).map((row) => row.id)), ['steer', 'queued'])
})

test('a queued Codex turn that cannot start stays first in a paused queue', async (t) => {
  t.mock.method(console, 'error', () => {})
  const adapter = createAdapter(
    './codex/CodexProviderAdapter.ts',
    'CodexProviderAdapter',
    ['deliverQueuedTurn'],
    [],
    `pendingMessageEdits = new PendingMessageEdits(); queuedTurnsByThread = new Map();
    pausedQueuedTurnThreads = new Set(); pendingTurnIds = new Map();`,
    { getFoundActiveTurnId: () => null }
  )
  const removed = []
  Object.assign(adapter, {
    hasActiveOrSubmittingTurn: () => false,
    addSubmittedPendingTurn: async (thread, text, options, id) => {
      adapter.pendingTurnIds.set(thread, id)
      return { id }
    },
    setThreadStatus: () => {},
    emitChatUpdated: () => {},
    getActiveTurnId: () => null,
    clearPendingTurnId: (thread) => adapter.pendingTurnIds.delete(thread),
    removeSyntheticTurn: (thread, id) => removed.push(id),
    startCodexTurn: async () => {
      throw new Error('thread already has an active writer')
    }
  })
  const first = { id: 'A', text: 'First' }
  adapter.queuedTurnsByThread.set('thread', [first, { id: 'B', text: 'Second' }])

  await adapter.deliverQueuedTurn('thread', first)

  assert.deepEqual(plain(adapter.queuedTurnsByThread.get('thread').map((turn) => turn.id)), [
    'A',
    'B'
  ])
  assert.ok(adapter.pausedQueuedTurnThreads.has('thread'), 'the rest of the queue waits')
  assert.deepEqual(plain(removed), ['A'], 'no failed placeholder turn is left behind')
})
