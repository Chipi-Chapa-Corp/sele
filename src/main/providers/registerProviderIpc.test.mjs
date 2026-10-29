import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import { providerIpcChannels as channels } from '../../shared/provider.ts'

const require = createRequire(import.meta.url)
const bundled = await build({
  entryPoints: [new URL('./registerProviderIpc.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['electron'],
  plugins: [
    {
      name: 'isolate-provider-ipc',
      setup(build) {
        build.onResolve({ filter: /^(\.\/providerService|\.\.\/logging)$/ }, (args) => ({
          path: args.path,
          namespace: 'test'
        }))
        build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
          contents: path.endsWith('logging')
            ? `export const handleLoggedIpc = (channel, handler) => globalThis.harness.handlers.set(channel, handler);
             export const logDiagnostic = (...args) => globalThis.harness.logs.push(args);`
            : `export const startLimitResetQueue = () => {};
             export const providerApi = {
               beginPendingMessageEdit: (...args) => globalThis.harness.beginPendingMessageEdit(...args),
               cancelPendingMessageEdit: (...args) => globalThis.harness.cancelPendingMessageEdit(...args),
               editPendingMessage: (...args) => globalThis.harness.editPendingMessage(...args),
               getAccounts: (...args) => globalThis.harness.getAccounts(...args),
               useAccount: (...args) => globalThis.harness.useAccount(...args),
               getLimitResetMessages: (...args) => globalThis.harness.limitReset('list', ...args),
               addLimitResetMessage: (...args) => globalThis.harness.limitReset('add', ...args),
               deleteLimitResetMessage: (...args) => globalThis.harness.limitReset('delete', ...args),
               getUsage: (...args) => globalThis.harness.getUsage(...args),
               createAccount: (...args) => globalThis.harness.createAccount(...args),
               getConnections: (...args) => globalThis.harness.connection('list', ...args),
               connectProvider: (...args) => globalThis.harness.connection('connect', ...args),
               getConnectionAttempt: (...args) => globalThis.harness.connection('status', ...args),
               completeConnection: (...args) => globalThis.harness.connection('complete', ...args),
               cancelConnection: (...args) => globalThis.harness.connection('cancel', ...args),
               deleteConnection: (...args) => globalThis.harness.connection('delete', ...args),
               onChatUpdated: listener => { globalThis.harness.publish = listener },
               getChat: (...args) => globalThis.harness.getChat(...args),
               getChats: (...args) => globalThis.harness.getChats(...args),
               continueChat: (...args) => globalThis.harness.continueChat(...args),
               startChat: (...args) => globalThis.harness.startChat(...args),
               updateChatPermissions: (...args) => globalThis.harness.updateChatPermissions(...args),
               resolveUserInput: (...args) => globalThis.harness.resolveUserInput(...args),
               getSubagent: (...args) => globalThis.harness.getSubagent(...args)
             };
             export const getProviderCachedChat = (...args) => globalThis.harness.getCachedChat?.(...args) ?? Promise.resolve(null);
             export const beginProviderChatHistoryRead = async () => globalThis.harness.historyRead ?? null;
             export const getProviderConversationViews = async (...args) => globalThis.harness.getConversationViews?.(...args) ?? [];
             export const getProviderKnownChats = async (...args) => globalThis.harness.getKnownChats(...args);
             export const beginProviderConversationRead = async () => ({key:'fixture',current:()=>true});
             export const saveProviderConversationView = async (...args) => globalThis.harness.persistView?.(...args) ?? globalThis.harness.savedViews?.push(args);
             export const saveProviderChatHistory = (...args) => globalThis.harness.savedHistory?.push(args);
             export const getChatUpdateSummary = () => {};
             export const getProviderChatCursorWindow = () => {};
             export const getProviderChatItemWindow = () => {};
             export const getProviderSubagentItemWindow = (...args) => globalThis.harness.getSubagent(args[0], args[1], args[2]);
             export const getProviderChatWindow = (...args) => globalThis.harness.getChatWindow(...args);`
        }))
      }
    }
  ]
})

const setup = () => {
  const ipcMain = new EventEmitter()
  const contents = new EventEmitter()
  const sent = []
  const timers = new Map()
  Object.assign(contents, {
    id: 1,
    isDestroyed: () => false,
    send: (channel, event) => sent.push({ channel, event })
  })
  const harness = { logs: [], publish: null, handlers: new Map() }
  const module = { exports: {} }
  vm.runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    harness,
    require: (name) =>
      name === 'electron'
        ? { ipcMain, BrowserWindow: { getAllWindows: () => [{ webContents: contents }] } }
        : require(name),
    setTimeout: (callback, delay) => {
      const timer = {
        unref() {
          return this
        }
      }
      timers.set(timer, { callback, delay })
      return timer
    },
    clearTimeout: (timer) => timers.delete(timer)
  })
  module.exports.registerProviderIpc()
  const emit = (channel, ...args) => ipcMain.emit(channel, { sender: contents }, ...args)
  emit(channels.chatUpdatesReady)
  emit(channels.viewedChatChanged, 'claude', 'first-chat')
  const publish = (revision, completed = false) =>
    harness.publish({
      providerId: 'claude',
      chatId: 'first-chat',
      turnCompleted: completed,
      summary: { id: 'first-chat', status: completed ? null : 'active' },
      detail: {
        id: 'first-chat',
        revision,
        status: completed ? null : 'active',
        items: [
          { type: 'message', id: 'prompt', role: 'user', content: 'PRIVATE PROMPT' },
          ...(completed
            ? [{ type: 'message', id: 'answer', role: 'assistant', content: 'PRIVATE ANSWER' }]
            : [])
        ]
      }
    })
  const expire = () => {
    const pending = [...timers.values()]
    timers.clear()
    pending.forEach(({ callback, delay }) => {
      assert.equal(delay, 2_000)
      callback()
    })
  }
  return { harness, module, sent, timers, emit, publish, expire, contents }
}

test('first-chat updates and completion arrive normally when acknowledged', () => {
  const h = setup()
  h.publish(1)
  h.publish(2, true)
  assert.equal(h.sent.length, 1)
  h.emit(channels.chatUpdateAcknowledged, h.sent[0].event.sequence, true)
  assert.equal(h.sent.length, 2)
  assert.equal(h.sent[1].event.turnCompleted, true)
  assert.equal(h.sent[1].event.detail.revision, 2)
  h.emit(channels.chatUpdateAcknowledged, h.sent[1].event.sequence, true)
  assert.equal(h.timers.size, 0)
  h.expire()
  assert.equal(h.harness.logs.length, 0)
})

test('opening records renderer-prepared pages and cached IPC preserves source validation', async () => {
  const h = setup()
  h.harness.historyRead = { token: 'fixture' }
  h.harness.savedHistory = []
  h.harness.getChat = async () => ({
    id: 'chat',
    revision: 1,
    status: null,
    items: [{ type: 'message', id: 'user', role: 'user', content: 'x'.repeat(600_000) }]
  })
  const prepared = await h.harness.handlers.get(channels.getChat)({}, 'codex', 'chat')
  assert.ok(prepared.items[0].content.length < 600_000)
  assert.equal(h.harness.savedHistory.length, 1)
  assert.equal(
    h.harness.savedHistory[0][1],
    prepared,
    'persist the bounded renderer payload, not raw history'
  )
  const scopes = []
  h.harness.getCachedChat = async (...args) => {
    scopes.push(args)
    return null
  }
  const read = h.harness.handlers.get(channels.getCachedChat)
  assert.equal(await read({}, 'codex', 'chat', { container: { kind: 'host' } }), null)
  assert.equal(scopes[0][0], 'codex')
  assert.equal(scopes[0][2].container.kind, 'host')
  assert.throws(() => read({}, 'invalid-provider', 'chat'))
  assert.throws(() => read({}, 'codex', 'chat', { container: { kind: 'invalid' } }))
})

test('local known-chat listing returns views while native discovery is unavailable', async () => {
  const h = setup()
  const view = {
    id: 'known',
    conversationView: true,
    items: [{ type: 'message', id: 'answer', role: 'assistant', content: 'Local answer' }]
  }
  h.harness.getKnownChats = async () => ({
    chats: [{ id: 'known', providerId: 'codex' }],
    nextCursor: null,
    conversationViews: [view]
  })
  h.harness.getChats = () => assert.fail('known listing must not discover native chats')
  h.harness.getChat = () => assert.fail('known listing must not hydrate native history')
  const page = await h.harness.handlers.get(channels.getKnownChats)({}, 'codex', {
    container: { kind: 'host' }
  })
  assert.equal(page.conversationViews[0], view)
  assert.equal(page.chats[0].id, 'known')
})

test('processed background updates deliver a ready view without requiring a selected transcript', () => {
  const h = setup()
  h.harness.publish({
    providerId: 'codex',
    chatId: 'background',
    conversationKnown: true,
    turnCompleted: false,
    summary: { id: 'background', revision: 1, status: 'active' },
    detail: {
      id: 'background',
      revision: 1,
      items: [{ type: 'message', id: 'u', role: 'user', content: 'Background message' }]
    }
  })
  assert.equal(h.sent[0].event.detail, null)
  assert.equal(h.sent[0].event.conversationView.conversationView, true)
  assert.equal(h.sent[0].event.conversationView.items[0].content, 'Background message')
})

test('first processing commits its durable view before replying, and discovery attaches known views', async () => {
  const h = setup()
  h.harness.getChat = async () => ({ id: 'unknown', revision: 1, items: [] })
  let release
  let persisted = false
  h.harness.persistView = () =>
    new Promise((resolve) => {
      release = () => {
        persisted = true
        resolve()
      }
    })
  let replied = false
  const open = h.harness.handlers
    .get(channels.getChat)({}, 'codex', 'unknown')
    .then((detail) => {
      replied = true
      return detail
    })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(replied, false)
  release()
  const detail = await open
  assert.equal(persisted, true)
  const view = { ...detail, conversationView: true }
  h.harness.getChats = async () => ({
    chats: [{ id: 'unknown', providerId: 'codex' }],
    nextCursor: null
  })
  h.harness.getConversationViews = async () => [view]
  const discovered = await h.harness.handlers.get(channels.getChats)({}, 'codex', {})
  assert.equal(discovered.conversationViews[0], view)
})

test('subagent IPC bounds a long transcript and serves exact older windows', async () => {
  const h = setup()
  const output = 'x'.repeat(10_000)
  const items = Array.from({ length: 1000 }, (_, turn) => [
    { type: 'message', id: `user-${turn}`, role: 'user', content: `prompt ${turn}` },
    {
      type: 'working',
      id: `work-${turn}`,
      status: 'worked',
      items: [
        {
          type: 'tool',
          id: `tool-${turn}`,
          toolId: `tool-${turn}`,
          activity: 'command',
          status: 'finished',
          label: 'Run',
          command: 'true',
          stdout: output,
          cwd: null,
          diffs: [],
          images: [],
          rawInput: null,
          rawOutput: null
        }
      ]
    },
    { type: 'message', id: `answer-${turn}`, role: 'assistant', content: `answer ${turn}` }
  ]).flat()
  items[items.length - 2].items = Array.from({ length: 1000 }, (_, toolIndex) => ({
    type: 'tool',
    id: `tool-999-${toolIndex}`,
    toolId: `tool-999-${toolIndex}`,
    activity: 'command',
    status: 'finished',
    label: 'Run',
    command: 'true',
    stdout: output,
    cwd: null,
    diffs: [],
    images: [],
    rawInput: null,
    rawOutput: null
  }))
  const calls = []
  h.harness.getSubagent = async (...args) => {
    calls.push(args)
    return {
      id: 'child',
      parentId: 'parent',
      title: 'Child',
      description: null,
      status: 'completed',
      createdAt: 1,
      updatedAt: 2,
      items
    }
  }
  const read = h.harness.handlers.get(channels.getSubagent)
  const latest = await read(null, 'claude', 'parent', 'child')
  assert.equal(latest.turnCount, 1000)
  assert.equal(latest.itemsStartTurnIndex, 990)
  assert.equal(latest.items[0].id, 'user-990')
  assert.equal(latest.items.at(-1).id, 'answer-999')
  assert.equal(latest.status, 'completed')
  assert.ok(JSON.stringify(latest).length < 2_500_000)
  const latestStep = latest.items.find((item) => item.id === 'work-999')
  assert.equal(latestStep.items[0].toolCount, 1000)
  const toolPage = await h.harness.handlers.get(channels.getChatWorkingToolPage)(
    null,
    'claude',
    'child',
    'work-999',
    latestStep.items[0].id,
    0,
    50,
    'parent'
  )
  assert.equal(toolPage.totalCount, 1000)
  assert.equal(toolPage.tools[0].id, 'tool-999-0')
  assert.ok(JSON.stringify(toolPage).length < 2_500_000)
  const older = await read(null, 'claude', 'parent', 'child', { startIndex: 0, limit: 10 })
  assert.equal(older.itemsStartTurnIndex, 0)
  assert.equal(older.turnCount, 1000)
  assert.equal(older.items[0].id, 'user-0')
  assert.equal(older.items.at(-1).id, 'answer-9')
  assert.equal(calls.length, 3)
  assert.equal(calls[1][3], undefined, 'working page uses the complete source on demand')
  assert.equal(calls[2][3].startIndex, 0)
})

test('a missing first acknowledgment recovers the latest full completion without content in logs', () => {
  const h = setup()
  h.publish(1)
  h.publish(2, true)
  h.expire()
  assert.equal(h.sent.length, 2)
  const recovered = h.sent[1].event
  assert.equal(recovered.detail.revision, 2)
  assert.equal(recovered.detail.baseRevision, null)
  assert.equal(recovered.turnCompleted, true)
  assert.equal(recovered.detail.changedItems.length, 2)
  h.emit(channels.chatUpdateAcknowledged, h.sent[0].event.sequence, true)
  h.publish(3)
  assert.equal(h.sent.length, 2, 'late acknowledgment must not release a newer packet')
  h.emit(channels.chatUpdateAcknowledged, recovered.sequence, true)
  assert.equal(h.sent.length, 3)
  assert.equal(h.sent[2].event.detail.baseRevision, 2)
  const [level, source, diagnostic] = h.harness.logs[0]
  assert.equal(level, 'warn')
  assert.equal(source, 'chat-update-delivery')
  assert.equal(diagnostic.inFlightRevision, 1)
  assert.equal(diagnostic.pending[0].revision, 2)
  assert.equal(diagnostic.pending[0].turnCompleted, true)
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE/)
})

test('recovery discards an older delta base and stays bounded across repeated missing acknowledgments', () => {
  const h = setup()
  h.publish(1)
  h.emit(channels.chatUpdateAcknowledged, h.sent[0].event.sequence, true)
  h.publish(2)
  assert.equal(h.sent[1].event.detail.baseRevision, 1)
  for (const revision of [3, 4, 5]) h.publish(revision)
  h.expire()
  assert.equal(h.sent.length, 3)
  assert.equal(h.sent[2].event.detail.revision, 5)
  assert.equal(h.sent[2].event.detail.baseRevision, null)
  assert.equal(h.timers.size, 1)
  h.publish(6, true)
  h.expire()
  assert.equal(h.sent.length, 4)
  assert.equal(h.sent[3].event.detail.revision, 6)
  assert.equal(h.sent[3].event.detail.baseRevision, null)
  assert.equal(h.sent[3].event.turnCompleted, true)
  h.emit(channels.chatUpdateAcknowledged, h.sent[3].event.sequence, true)
  assert.equal(h.timers.size, 0)
})

test('recovery preserves completion when the same chat has already started another turn', () => {
  const h = setup()
  h.emit(channels.viewedChatChanged, 'codex', 'other-chat')
  h.publish(1, true) // A summary-only completion is now in flight.
  assert.equal(h.sent[0].event.detail, null)
  h.emit(channels.viewedChatChanged, 'claude', 'first-chat')
  h.harness.publish({
    providerId: 'claude',
    chatId: 'first-chat',
    turnCompleted: false,
    summary: { id: 'first-chat', status: 'active' },
    detail: { id: 'first-chat', revision: 2, status: 'active', items: [] }
  })
  h.expire()
  assert.equal(h.sent.length, 2)
  assert.equal(h.sent[1].event.detail.revision, 2)
  assert.equal(h.sent[1].event.turnCompleted, true, 'coalescing must retain the completion signal')
})

test('a stalled background chat cannot block the viewed Claude chat or lose its own completion', () => {
  const h = setup()
  h.harness.publish({
    providerId: 'codex',
    chatId: 'background',
    turnCompleted: true,
    summary: { id: 'background', status: null },
    detail: { id: 'background', revision: 1, status: null, items: [] }
  })
  assert.equal(h.sent[0].event.detail, null)
  h.publish(1)
  h.expire()
  assert.equal(h.sent.length, 2)
  assert.equal(h.sent[1].event.chatId, 'first-chat')
  assert.equal(h.sent[1].event.detail.baseRevision, null)
  h.emit(channels.chatUpdateAcknowledged, h.sent[1].event.sequence, true)
  assert.equal(h.sent.length, 3)
  assert.equal(h.sent[2].event.chatId, 'background')
  assert.equal(h.sent[2].event.turnCompleted, true)
  assert.equal(h.sent[2].event.detail, null)
})

test('an unacknowledged update with no queued successor does not report a streaming stall', () => {
  const h = setup()
  h.publish(1)
  h.expire()
  assert.equal(h.harness.logs.length, 0)
  h.publish(2, true)
  h.expire()
  assert.equal(h.harness.logs.length, 1)
})

test('stopping the subscription, destroying the window, and shutdown cancel diagnostics', () => {
  for (const stop of [
    (h) => h.emit(channels.chatUpdatesStopped),
    (h) => h.contents.emit('destroyed'),
    (h) => h.module.exports.beginProviderIpcShutdown()
  ]) {
    const h = setup()
    h.publish(1)
    h.publish(2, true)
    stop(h)
    assert.equal(h.timers.size, 0)
    h.expire()
    assert.equal(h.harness.logs.length, 0)
  }
})

test('opening Codex through renderer IPC checks access before any send or edit', async () => {
  const h = setup()
  const calls = []
  h.harness.getChat = async (providerId, chatId) => {
    calls.push([providerId, chatId])
    return {
      id: chatId,
      revision: 1,
      items: [],
      writeAccess: 'readOnly',
      writeAccessReason: 'externalOwner',
      capabilities: { editMessages: false, activeMessages: false }
    }
  }
  h.harness.getChatWindow = () => assert.fail('opening Codex must not bypass its writer check')
  const detail = await h.harness.handlers.get(channels.getChat)({}, 'codex', 'external-chat')
  assert.deepEqual(calls, [['codex', 'external-chat']])
  assert.equal(detail.writeAccess, 'readOnly')
  assert.equal(detail.writeAccessReason, 'externalOwner')
  assert.equal(detail.capabilities.editMessages, false)
})

test('other providers retain bounded opening reads', async () => {
  const h = setup()
  h.harness.getChat = () => assert.fail('must preserve paginated reads for other providers')
  h.harness.getChatWindow = async (providerId, chatId, window) => {
    assert.equal(providerId, 'claude')
    assert.equal(window.startIndex, null)
    assert.ok(window.limit > 0)
    return { id: chatId, items: [] }
  }
  const detail = await h.harness.handlers.get(channels.getChat)({}, 'claude', 'chat')
  assert.equal(detail.id, 'chat')
})

test('new chats preserve No Project across IPC for every provider', async () => {
  const h = setup()
  const calls = []
  h.harness.startChat = async (providerId, _message, options) => {
    calls.push({ providerId, options })
    return { id: 'general-chat', revision: 1, items: [] }
  }
  const handler = h.harness.handlers.get(channels.startChat)
  const options = {
    model: 'fixture',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write',
    noProject: true
  }
  for (const providerId of ['codex', 'claude', 'copilot', 'opencode-v2']) {
    await handler({}, providerId, 'Help me with my computer', options)
    assert.equal(calls.at(-1).providerId, providerId)
    assert.equal(calls.at(-1).options.noProject, true)
    assert.equal(calls.at(-1).options.cwd, undefined)
  }
  await assert.rejects(handler({}, 'codex', 'Hello', { ...options, noProject: 'true' }))
  assert.equal(calls.length, 4)
})

test('new-chat IPC preserves native goals and rejects blank or malformed objectives', async () => {
  const h = setup()
  const received = []
  h.harness.startChat = async (provider, message, options) => {
    received.push({ provider, message, options })
    return { id: 'goal-chat', revision: 1, items: [] }
  }
  const handler = h.harness.handlers.get(channels.startChat)
  const options = {
    model: 'fixture',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    initialGoal: '  Checks pass\nand lint is clean  '
  }
  for (const provider of ['codex', 'claude', 'copilot']) {
    await handler({}, provider, 'Checks pass', options)
    assert.equal(received.at(-1).options.initialGoal, 'Checks pass\nand lint is clean')
    assert.equal(received.at(-1).options.model, 'fixture')
  }
  for (const initialGoal of ['', '   ', null, 42, {}, ['goal']])
    await assert.rejects(
      handler({}, 'codex', 'Checks pass', { ...options, initialGoal }),
      /Invalid initial goal/
    )
  assert.equal(received.length, 3)
})

test('chat IPC forwards validated retry settings and rejects invalid values', async () => {
  const h = setup()
  let received
  h.harness.continueChat = async (_providerId, _id, _message, options) => {
    received = options.networkRetry
    return { id: 'chat', revision: 1, items: [] }
  }
  const handler = h.harness.handlers.get(channels.continueChatSummary)
  const options = {
    model: 'gpt-5.5',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'workspace-write'
  }
  await handler({}, 'codex', 'chat', 'task', {
    ...options,
    networkRetry: { count: 7, delaySeconds: 1.5 }
  })
  assert.equal(received.count, 7)
  assert.equal(received.delaySeconds, 1.5)
  for (const networkRetry of [
    null,
    [],
    { count: -1, delaySeconds: 2 },
    { count: 1.5, delaySeconds: 2 },
    { count: 10, delaySeconds: 0 },
    { count: 10, delaySeconds: Infinity },
    { count: '10', delaySeconds: 2 }
  ]) {
    await assert.rejects(
      handler({}, 'codex', 'chat', 'task', { ...options, networkRetry }),
      /Invalid network retry settings/
    )
  }
})

test('live permission IPC validates choices and forwards only permission fields', async () => {
  const h = setup()
  const calls = []
  h.harness.updateChatPermissions = async (...args) => {
    calls.push(args)
  }
  const handler = h.harness.handlers.get(channels.updateChatPermissions)
  const options = {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
    additionalDirectories: ['/reference'],
    model: 'ignored',
    container: { kind: 'host' }
  }
  await handler({}, 'opencode-v2', 'chat', options)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    'opencode-v2',
    'chat',
    {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxMode: 'danger-full-access',
      additionalDirectories: ['/reference']
    }
  ])
  for (const value of [
    null,
    [],
    {},
    { ...options, sandboxMode: 'invalid' },
    { ...options, approvalPolicy: 'invalid' },
    { ...options, approvalsReviewer: 'invalid' },
    { ...options, additionalDirectories: ['relative'] },
    { ...options, additionalDirectories: ['/bad\0path'] }
  ]) {
    assert.throws(() => handler({}, 'opencode-v2', 'chat', value), /Invalid/)
  }
  assert.equal(calls.length, 1)
})

test('question answer IPC forwards selected turn settings and validates permissions', async () => {
  const h = setup()
  const calls = []
  h.harness.resolveUserInput = async (...args) => {
    calls.push(args)
    return { id: 'chat', revision: 1, items: [] }
  }
  const handler = h.harness.handlers.get(channels.resolveUserInput)
  const response = { kind: 'answer', answer: 'Continue Login', wasFreeform: false }
  const options = {
    model: 'gpt-6.1-sol',
    reasoningEffort: 'high',
    serviceTier: 'fast',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandboxMode: 'danger-full-access',
    cwd: '/project',
    additionalDirectories: ['/shared']
  }
  await handler({}, 'codex', 'chat', 'question', response, options)
  const received = calls[0][4]
  for (const key of [
    'model',
    'reasoningEffort',
    'serviceTier',
    'approvalPolicy',
    'sandboxMode',
    'cwd'
  ]) {
    assert.equal(received[key], options[key])
  }
  assert.deepEqual(Array.from(received.additionalDirectories), ['/shared'])
  for (const invalid of [{ approvalPolicy: 'invalid' }, { sandboxMode: 'invalid' }]) {
    await assert.rejects(
      handler({}, 'codex', 'chat', 'question', response, { ...options, ...invalid }),
      /Invalid (approval policy|sandbox mode)/
    )
  }
  assert.equal(calls.length, 1)
  await handler({}, 'codex', 'chat', 'question', { kind: 'cancel' })
  assert.equal(calls[1][4], undefined)
})

test('elicitation IPC preserves structured values and rejects invalid actions and content', async () => {
  const h = setup()
  const calls = []
  h.harness.resolveUserInput = async (...args) => {
    calls.push(args)
    return { id: 'chat', revision: 1, items: [] }
  }
  const handler = h.harness.handlers.get(channels.resolveUserInput)
  const content = { enabled: false, count: 3, sections: ['summary'], nested: { value: 'x' } }
  await handler({}, 'codex', 'chat', 'form', { kind: 'elicitation', action: 'accept', content })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][3])), {
    kind: 'elicitation',
    action: 'accept',
    content
  })
  for (const response of [
    { kind: 'elicitation', action: 'unknown' },
    { kind: 'elicitation', action: 'accept', content: [] },
    { kind: 'elicitation', action: 'accept', content: { text: 'x'.repeat(100_001) } }
  ])
    await assert.rejects(handler({}, 'codex', 'chat', 'form', response), /Invalid elicitation/)
  assert.equal(calls.length, 1)
})

test('sidebar search IPC forwards native queries and opaque cursors and rejects invalid input', async () => {
  const h = setup()
  const requests = []
  h.harness.getChats = async (_provider, options) => {
    requests.push(options)
    return { chats: [], nextCursor: null }
  }
  const list = h.harness.handlers.get(channels.getChats)
  await list({}, 'codex', { searchTerm: 'query', cursor: 'next', limit: 20 })
  assert.equal(requests.at(-1).searchTerm, 'query')
  assert.equal(requests.at(-1).cursor, 'next')
  for (const searchTerm of ['', '  ', null, 123]) {
    assert.throws(() => list({}, 'codex', { searchTerm }), /Invalid chat search term/)
  }
})

test('connection IPC validates secrets and forwards each operation to the selected source', async () => {
  const h = setup()
  const calls = []
  h.harness.connection = async (...args) => {
    calls.push(JSON.parse(JSON.stringify(args)))
    return []
  }
  const source = { container: { kind: 'container', tool: 'toolbox', name: 'fixture' } }
  const invoke = (channel, ...args) => h.harness.handlers.get(channel)({}, 'opencode-v2', ...args)
  await invoke(channels.getConnections, source)
  await invoke(
    channels.connectProvider,
    { integrationId: 'openai', method: 'key', key: ' fixture-key ' },
    source
  )
  assert.deepEqual(calls.at(-1), [
    'connect',
    'opencode-v2',
    { integrationId: 'openai', method: 'key', key: 'fixture-key' },
    source
  ])
  await invoke(
    channels.connectProvider,
    {
      integrationId: 'copilot',
      method: 'oauth',
      methodId: '0',
      inputs: { domain: 'fixture.test' }
    },
    source
  )
  assert.deepEqual(calls.at(-1)[2].inputs, { domain: 'fixture.test' })
  for (const channel of [
    channels.getConnectionAttempt,
    channels.cancelConnection,
    channels.deleteConnection
  ]) {
    await invoke(channel, 'identifier', source)
    assert.deepEqual(calls.at(-1).at(-1), source)
  }
  await invoke(channels.completeConnection, 'attempt', ' code ', source)
  assert.deepEqual(calls.at(-1), ['complete', 'opencode-v2', 'attempt', 'code', source])
  for (const input of [
    null,
    {},
    { integrationId: 'openai', method: 'key', key: '' },
    { integrationId: 'copilot', method: 'oauth', methodId: '0', inputs: { key: 42 } },
    { integrationId: 'openai', method: 'invalid' }
  ]) {
    assert.throws(() => invoke(channels.connectProvider, input, source), /Invalid connection/)
  }
  assert.throws(
    () => invoke(channels.completeConnection, 'attempt', '', source),
    /Invalid connection/
  )
  assert.throws(
    () => invoke(channels.getConnections, { container: { kind: 'invalid' } }),
    /Invalid/
  )
})

test('account creation IPC takes only provider and source, with no custom label argument', async () => {
  const h = setup()
  const calls = []
  h.harness.createAccount = async (...args) => {
    calls.push(JSON.parse(JSON.stringify(args)))
    return { accountId: 'fixture' }
  }
  const create = h.harness.handlers.get(channels.createAccount)
  const source = { container: { kind: 'container', tool: 'toolbox', name: 'fixture' } }
  await create({}, 'claude', source)
  assert.deepEqual(calls, [['claude', source]])
  assert.throws(() => create({}, 'claude', 'Legacy label'), /Invalid/)
})

test('renderer destruction releases an edit only after its begin operation finishes', async () => {
  const h = setup()
  let begun
  const released = []
  h.harness.beginPendingMessageEdit = () =>
    new Promise((resolve) => {
      begun = resolve
    })
  h.harness.cancelPendingMessageEdit = async (...args) => {
    released.push(args)
    return { id: 'chat', items: [] }
  }
  const begin = h.harness.handlers.get(channels.beginPendingMessageEdit)
  const opening = begin({ sender: h.contents }, 'copilot', 'chat', 'message', 'edit')
  h.contents.emit('destroyed')
  assert.equal(released.length, 0)
  begun({ id: 'chat', items: [] })
  await opening
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(Array.from(released[0]), ['copilot', 'chat', 'message', 'edit'])
})

test('successful pending saves forward the token and remove renderer cleanup ownership', async () => {
  const h = setup()
  const released = []
  const saved = []
  h.harness.beginPendingMessageEdit = async () => ({ id: 'chat', items: [] })
  h.harness.cancelPendingMessageEdit = async (...args) => {
    released.push(args)
    return { id: 'chat', items: [] }
  }
  h.harness.editPendingMessage = async (...args) => {
    saved.push(args)
    return { id: 'chat', items: [] }
  }
  const event = { sender: h.contents }
  await h.harness.handlers.get(channels.beginPendingMessageEdit)(
    event,
    'copilot',
    'chat',
    'message',
    'edit'
  )
  await h.harness.handlers.get(channels.editPendingMessage)(
    event,
    'copilot',
    'chat',
    'message',
    'revised',
    undefined,
    'edit'
  )
  assert.deepEqual(Array.from(saved[0]), [
    'copilot',
    'chat',
    'message',
    'revised',
    undefined,
    'edit'
  ])
  h.contents.emit('destroyed')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(released, [])
})

test('a full renderer reload releases its edit while hash and subframe navigation preserve it', async () => {
  const h = setup()
  const released = []
  h.harness.beginPendingMessageEdit = async () => ({ id: 'chat', items: [] })
  h.harness.cancelPendingMessageEdit = async (...args) => {
    released.push(args)
    return { id: 'chat', items: [] }
  }
  await h.harness.handlers.get(channels.beginPendingMessageEdit)(
    { sender: h.contents },
    'copilot',
    'chat',
    'message',
    'edit'
  )
  h.contents.emit('did-start-navigation', {}, 'about:blank#hash', true, true)
  h.contents.emit('did-start-navigation', {}, 'about:blank', false, false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(released.length, 0)
  h.contents.emit('did-start-navigation', {}, 'about:blank', false, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(Array.from(released[0]), ['copilot', 'chat', 'message', 'edit'])
})

test('account IPC preserves validated chat scope and rejects malformed IDs', async () => {
  const h = setup()
  const calls = []
  h.harness.createAccount = async (...args) => {
    calls.push(JSON.parse(JSON.stringify(args)))
  }
  const create = h.harness.handlers.get(channels.createAccount)
  await create({}, 'claude', { chatId: 'saved-chat', accountId: 'cannot-override-credentials' })
  assert.deepEqual(calls, [['claude', { chatId: 'saved-chat' }]])
  for (const chatId of ['', 42, 'a\0b', 'x'.repeat(513)])
    assert.throws(() => create({}, 'claude', { chatId }), /Invalid chat ID/)
})

test('new-chat account operations accept the null scope produced by JSON serialization', async () => {
  const h = setup()
  const calls = []
  h.harness.createAccount = async (...args) => {
    calls.push(JSON.parse(JSON.stringify(args)))
  }
  const create = h.harness.handlers.get(channels.createAccount)
  await create({}, 'codex', { chatId: null })
  assert.deepEqual(calls, [['codex', {}]])
})

test('new-chat picker reads and switches the default without a chat ID', async () => {
  const h = setup()
  let account = 'personal'
  h.harness.getAccounts = async (_provider, options) => {
    assert.equal(options.chatId, undefined)
    return account
  }
  h.harness.useAccount = async (_provider, id, options) => {
    assert.equal(options.chatId, undefined)
    account = id
  }
  const read = h.harness.handlers.get(channels.getAccounts)
  const select = h.harness.handlers.get(channels.useAccount)
  const serializedScope = JSON.parse(
    JSON.stringify({
      container: null,
      chatId: JSON.parse(JSON.stringify(['codex', null, undefined]))[2]
    })
  )
  assert.equal(await read({}, 'codex', serializedScope), 'personal')
  await select({}, 'codex', 'work', serializedScope)
  assert.equal(await read({}, 'codex', serializedScope), 'work')
})

test('usage IPC follows each chat account and preserves the default for new chats', async () => {
  const h = setup()
  const accounts = new Map([['chat', 'personal']])
  let defaultAccount = 'work'
  h.harness.useAccount = async (_provider, account, options) => {
    if (options?.chatId) accounts.set(options.chatId, account)
    else defaultAccount = account
  }
  h.harness.getUsage = async (_provider, options) => {
    const account = options?.chatId ? accounts.get(options.chatId) : defaultAccount
    return {
      rateLimits: [{ usedPercent: account === 'personal' ? 10 : 80 }],
      statisticsLoaded: options?.includeStatistics
    }
  }
  const usage = h.harness.handlers.get(channels.getUsage)
  const select = h.harness.handlers.get(channels.useAccount)
  assert.equal((await usage({}, 'codex', { chatId: 'chat' })).rateLimits[0].usedPercent, 10)
  await select({}, 'codex', 'work', { chatId: 'chat' })
  assert.equal((await usage({}, 'codex', { chatId: 'chat' })).rateLimits[0].usedPercent, 80)
  await select({}, 'codex', 'personal', { chatId: null })
  assert.equal((await usage({}, 'codex', { chatId: 'chat' })).rateLimits[0].usedPercent, 80)
  const nextChat = await usage({}, 'codex', { chatId: null, includeStatistics: true })
  assert.equal(nextChat.rateLimits[0].usedPercent, 10)
  assert.equal(nextChat.statisticsLoaded, true)
  assert.throws(() => usage({}, 'codex', { chatId: 42 }), /Invalid chat ID/)
})

test('reset queue IPC validates chat, prompt, settings and message IDs', async () => {
  const h = setup()
  const calls = []
  h.harness.limitReset = async (...args) => calls.push(JSON.parse(JSON.stringify(args)))
  const list = h.harness.handlers.get(channels.getLimitResetMessages)
  const add = h.harness.handlers.get(channels.addLimitResetMessage)
  const remove = h.harness.handlers.get(channels.deleteLimitResetMessage)
  const options = {
    model: 'gpt-5.5',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    serviceTier: null
  }
  await list({}, 'codex', 'chat')
  await add({}, 'codex', 'chat', 'after reset', options)
  await remove({}, 'codex', 'chat', 'message')
  assert.deepEqual(
    calls.map((call) => call.slice(0, 3)),
    [
      ['list', 'codex', 'chat'],
      ['add', 'codex', 'chat'],
      ['delete', 'codex', 'chat']
    ]
  )
  assert.equal(calls[1][3], 'after reset')
  assert.equal(calls[1][4].model, 'gpt-5.5')
  assert.throws(() => add({}, 'codex', 'chat', '   ', options), /empty|Invalid message/i)
  assert.throws(() => add({}, 'codex', 'chat', 'prompt', undefined), /options are required/)
  assert.throws(() => list({}, 'codex', ''), /Invalid chat ID/)
  assert.throws(() => remove({}, 'codex', 'chat', ''), /Invalid message ID/)
})

test('reset queue IPC accepts persistent new-chat draft targets and strips internal startup flags', async () => {
  const h = setup()
  const calls = []
  h.harness.limitReset = async (...args) => calls.push(JSON.parse(JSON.stringify(args)))
  const target = { draftKey: 'new-chat-project', worktree: true }
  const options = {
    model: 'gpt-5.5',
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    serviceTier: null,
    noProject: true,
    deferInitialMessage: true,
    accountId: 'cannot-override'
  }
  const add = h.harness.handlers.get(channels.addLimitResetMessage)
  await h.harness.handlers.get(channels.getLimitResetMessages)({}, 'codex', target)
  await add({}, 'codex', target, 'start later', options)
  await h.harness.handlers.get(channels.deleteLimitResetMessage)({}, 'codex', target, 'message')
  assert.deepEqual(
    calls.map((call) => call[2]),
    [target, target, target]
  )
  assert.equal(calls[1][4].noProject, true)
  assert.equal(calls[1][4].deferInitialMessage, undefined)
  assert.equal(calls[1][4].accountId, undefined)
  for (const target of [
    null,
    {},
    [],
    { draftKey: '' },
    { draftKey: 42 },
    { draftKey: 'valid', worktree: 'yes' }
  ])
    assert.throws(() => add({}, 'codex', target, 'prompt', options), /Invalid/)
})

test('subagent IPC forwards cursor navigation and retains the provider paging metadata', async () => {
  const h = setup()
  let args
  const pagination = { kind: 'cursor', olderCursor: 'older', newerCursor: 'newer' }
  h.harness.getSubagent = async (...input) => {
    args = input
    return {
      id: 'child',
      items: [],
      itemsStartTurnIndex: 0,
      turnCount: 0,
      turnPagination: pagination
    }
  }
  const read = h.harness.handlers.get(channels.getSubagent)
  const page = await read({}, 'claude', 'root', 'child', {
    startIndex: null,
    limit: 10,
    cursor: 'opaque-child',
    direction: 'older'
  })
  assert.deepEqual(JSON.parse(JSON.stringify(args)), [
    'claude',
    'root',
    'child',
    {
      startIndex: null,
      limit: 10,
      cursor: 'opaque-child',
      direction: 'older'
    }
  ])
  assert.deepEqual(page.turnPagination, pagination)
  await assert.rejects(
    read({}, 'claude', 'root', 'child', { cursor: 3 }),
    /Invalid subagent history cursor/
  )
})
