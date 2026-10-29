import { isNoProjectChat } from '../../shared/noProject.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getCodexTurnOutcome } from './codex/CodexTurnOutcome.ts'
import * as opencode from './opencode/OpenCodeItemRenderers.ts'
import * as opencodeV2 from './opencode/OpenCodeV2Client.ts'
import { isDefaultOpenCodeTitle } from './opencode/OpenCodeChatTitle.ts'
import { getOpenCodeUsageLimitMessage } from './opencode/OpenCodeUsageLimit.ts'
import * as claude from './claude/ClaudeItemRenderers.ts'
import * as copilot from './copilot/CopilotItemRenderers.ts'
import * as codex from './codex/CodexItemRenderers.ts'
import { getLastTurnOutcome } from '../../shared/chatTurnOutcome.ts'

const source = (path) =>
  ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
const codexStatusSource = source('./codex/CodexProviderAdapter.ts')
const codexStatuses = vm.runInNewContext(
  ts.transpile(
    `${codexStatusSource.statements
      .filter(ts.isVariableStatement)
      .flatMap((node) => [...node.declarationList.declarations])
      .filter((node) =>
        ['getThreadMetadataStatus', 'getHydratedThreadStatus'].includes(
          node.name.getText(codexStatusSource)
        )
      )
      .map((node) => `const ${node.getText(codexStatusSource)}`)
      .join('\n')}
    ({ getThreadMetadataStatus, getHydratedThreadStatus })`,
    { target: ts.ScriptTarget.ES2022 }
  )
)
const adapter = (path, methods, globals) => {
  const parsed = source(path)
  const declaration = parsed.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text.endsWith('ProviderAdapter')
  )
  return vm.runInNewContext(
    ts.transpile(
      `new (class {
    ${declaration.members
      .filter((node) => methods.includes(node.name?.getText(parsed)))
      .map((node) => node.getText(parsed))
      .join('\n')}
  })()`,
      { target: ts.ScriptTarget.ES2022 }
    ),
    { console, ...globals }
  )
}
const enrich = (metadata) => {
  const parsed = source('./providerService.ts')
  const declarations = parsed.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .filter((node) =>
      ['applyMetadataToChat', 'applyMetadataToChats'].includes(node.name.getText(parsed))
    )
  return vm.runInNewContext(
    ts.transpile(
      `
    ${declarations.map((node) => `const ${node.getText(parsed)}`).join('\n')}
    applyMetadataToChats
  `,
      { target: ts.ScriptTarget.ES2022 }
    ),
    {
      isNoProjectChat,
      // A fresh installation/restart has no previously observed outcome cache.
      getChatTurnOutcomes: async () => new Map(),
      getChatMetadataByIds: async (ids) => new Map(ids.map((id) => [id, metadata])),
      getCwdMetadata: async () => ({ kind: 'directory' }),
      getMessageReviews: async () => []
    }
  )
}

test('Codex cold sidebar reads a stopped last turn before opening it, and after restart', async () => {
  let status = 'interrupted'
  const requests = []
  const coldStart = () => {
    const instance = adapter(
      './codex/CodexProviderAdapter.ts',
      ['getChatsInContext', 'getSidebarTurnSummary'],
      {
        ...codexStatuses,
        getCodexTurnOutcome,
        isCodexSubagentThread: () => false,
        loadSessionThreadNames: async () => new Map(),
        getThreadTitle: () => 'Chat',
        getThreadApiCwd: () => '/repo'
      }
    )
    Object.assign(instance, {
      id: 'codex',
      userQuestions: { getPending: () => null },
      threadListScanClients: new WeakSet(),
      pendingTurnStarts: new Map(),
      pendingTurnIds: new Map(),
      withResolvedThreadName: (value) => value,
      rememberThreadContainer() {},
      getProviderPendingApproval: () => null,
      getCurrentContainer: () => null,
      client: {
        request: async (method, params) => {
          requests.push({ method, params })
          if (method === 'thread/list')
            return {
              data: [
                {
                  id: 'chat',
                  preview: '',
                  createdAt: 1,
                  updatedAt: 2,
                  status: { type: 'notLoaded' }
                }
              ],
              nextCursor: null
            }
          assert.equal(method, 'thread/turns/list')
          assert.equal(params.limit, 1)
          assert.equal(params.itemsView, 'notLoaded')
          assert.equal(params.sortDirection, 'desc')
          return { data: [{ id: 'last-turn', status, startedAt: 2, completedAt: 3 }] }
        }
      }
    })
    return instance
  }
  for (const seenUpdatedAt of [null, 2000]) {
    const enrichChats = enrich({ seenUpdatedAt })
    for (let restart = 0; restart < 2; restart++) {
      const page = await coldStart().getChatsInContext()
      const [chat] = await enrichChats(page.chats)
      assert.equal(chat.lastTurnOutcome, 'stopped')
      assert.equal(
        chat.updatedAt,
        3000,
        'completion time survives restart even when thread metadata is older'
      )
      assert.equal(chat.seenUpdatedAt, seenUpdatedAt)
    }
  }
  status = 'completed'
  const [continued] = await enrich({ seenUpdatedAt: 2000 })(
    (await coldStart().getChatsInContext()).chats
  )
  assert.equal(continued.lastTurnOutcome, null)
  assert.ok(requests.every(({ method }) => ['thread/list', 'thread/turns/list'].includes(method)))
})

const user = (id) => ({
  info: { id, role: 'user', time: { created: 1000 } },
  parts: [{ type: 'text', id: `${id}:text`, text: 'Request' }]
})
const reply = (id, error) => ({
  info: { id, role: 'assistant', error, time: { created: 1100, completed: 1200 } },
  parts: []
})

test('OpenCode native errors survive cold listing, reopening and another list refresh', async () => {
  const messages = [
    user('user'),
    reply('reply', { name: 'APIError', data: { message: 'Request failed', statusCode: 401 } })
  ]
  const session = {
    id: 'chat',
    directory: '/repo',
    title: 'Chat',
    time: { created: 1000, updated: 2000 }
  }
  for (const seenUpdatedAt of [null, 2000]) {
    const instance = adapter(
      './opencode/OpenCodeProviderAdapter.ts',
      ['getChats', 'createChat', 'getChatStatus', 'createChatDetailFromState'],
      {
        ...opencode,
        ...opencodeV2,
        isDefaultOpenCodeTitle,
        getOpenCodeUsageLimitMessage,
        requireData: (value) => value.data,
        isOneShotSession: () => false,
        getPendingApproval: () => null,
        getPendingUserInput: () => null,
        getMessagePreview: () => 'Request'
      }
    )
    const state = {
      id: 'chat',
      revision: 0,
      directory: '/repo',
      session,
      messages,
      active: false,
      stopped: false,
      failed: false,
      pendingApprovals: [],
      pendingQuestions: [],
      queuedMessages: [],
      messagesHydrated: false
    }
    Object.assign(instance, {
      getClientEntry: async () => ({
        container: null,
        client: {
          experimental: { session: { list: async () => ({ data: [session] }) } },
          session: {
            status: async () => ({ data: {} }),
            messages: async () => ({ data: messages, response: new Response() })
          }
        }
      }),
      rememberSession: () => state,
      loadMessages: async () => messages,
      // Pending-message durability is exercised by PersistentPendingMessages.test.mjs.
      persistPendingMessages() {},
      getContextUsage: () => null
    })
    const enrichChats = enrich({ seenUpdatedAt })
    const [cold] = await enrichChats((await instance.getChats()).chats)
    assert.equal(cold.status, null, 'historical failure has no live session.error flag')
    assert.equal(cold.lastTurnOutcome, 'failed')
    const opened = instance.createChatDetailFromState(state, { startIndex: null, limit: 10 })
    assert.equal(getLastTurnOutcome(opened), 'failed')
    state.messagesHydrated = true
    const [closed] = await enrichChats((await instance.getChats()).chats)
    assert.equal(closed.lastTurnOutcome, 'failed')
    messages.push(user('continue'), reply('successful', undefined))
    const [continued] = await enrichChats((await instance.getChats()).chats)
    assert.equal(continued.lastTurnOutcome, null)
    messages.splice(2)
  }
})

test('Codex persisted completion errors are failures even with a completed status', () => {
  const error = { message: 'Usage limit', codexErrorInfo: 'usageLimitExceeded' }
  assert.equal(getCodexTurnOutcome({ status: 'completed', error }), 'failed')
  assert.equal(getCodexTurnOutcome({ status: 'completed', error: null }), null)
})

// Every provider goes through its real list builder, detail builder, and shared enrichment.
// Only native transports and unrelated metadata are fixtures. No provider is started/resumed.
const coldFixture = (provider, outcome) => {
  const common = {
    id: 'chat',
    revision: 0,
    createdAt: 1000,
    updatedAt: 2000,
    cwd: '/repo',
    directory: '/repo',
    active: false,
    stopped: false,
    failed: false,
    container: null,
    pendingApprovals: [],
    pendingPermissions: [],
    pendingUserInputs: [],
    pendingQuestions: [],
    pendingMessages: [],
    queuedMessages: [],
    partialMessages: new Map()
  }
  const bindings = {
    getContainerTargetKey: () => 'host',
    getPendingApproval: () => null,
    getPendingUserInput: () => null,
    getContextUsage: () => null,
    truncate: (value) => value,
    maxPreviewLength: 500
  }
  const configure = (instance) =>
    Object.assign(instance, {
      id: provider,
      states: new Map(),
      sessionContainers: new Map(),
      authenticationFailures: new Set(),
      sessionMetadata: new Map(),
      hiddenSessionIds: new Set(),
      clientsWithoutPersistedEvents: new WeakSet(),
      eventStores: new WeakMap(),
      transcriptProjections: new Map(),
      detailRevision: 0,
      getPendingApproval: () => null,
      getPendingUserInput: () => null,
      getContextUsage: () => null,
      getPendingMessages: () => [],
      getDrainingMessage: () => null,
      getTitle: () => 'Chat',
      getCwd: () => '/repo',
      persistPendingMessages() {},
      applySessionMetadata() {}
    })
  if (provider === 'claude') {
    const message = (type, uuid, content, extra = {}) => ({
      type,
      uuid,
      parent_tool_use_id: null,
      message: { content },
      ...extra
    })
    const messages = [
      message('user', 'old-user', 'Previous request'),
      message('assistant', 'old-error', [{ type: 'text', text: 'Prior error' }], {
        error: 'server_error'
      }),
      message('user', 'user', 'Latest request'),
      ...(outcome === 'stopped'
        ? [message('user', 'interrupt', '[Request interrupted by user]')]
        : [
            message(
              'assistant',
              'reply',
              [{ type: 'text', text: 'Reply' }],
              outcome === 'failed' ? { error: 'rate_limit' } : {}
            )
          ])
    ]
    const metadata = { sessionId: 'chat', summary: 'Chat', cwd: '/repo', lastModified: 2000 }
    const instance = configure(
      adapter(
        './claude/ClaudeProviderAdapter.ts',
        ['getChats', 'createChatFromMetadata', 'createChatFromState', 'createChatDetail'],
        {
          ...bindings,
          ...claude,
          normalizeContainerTarget: () => ({ kind: 'host' }),
          isStoredContainer: () => false,
          getClaudeSessionTitle: () => 'Chat'
        }
      )
    )
    instance.sessionDiscovery = { list: async () => ({ sessions: [metadata], nextCursor: null }) }
    instance.readHistoryPage = async (_id, _container, window) => {
      assert.equal(window.limit, 1)
      return {
        messages,
        metadata,
        pagination: { kind: 'cursor', olderCursor: null, newerCursor: null }
      }
    }
    const state = { ...common, messages, metadata }
    return {
      list: () => instance.getChats(),
      open: () => {
        instance.states.set('chat', state)
        return instance.createChatDetail(state)
      }
    }
  }
  if (provider === 'copilot') {
    const event = (type, id, data = {}) => ({
      type,
      id,
      timestamp: new Date(2000).toISOString(),
      data
    })
    const events = [
      event('user.message', 'old-user', { content: 'Previous request' }),
      event('session.error', 'old-error', { message: 'Prior error' }),
      event('user.message', 'user', { content: 'Latest request' }),
      event('assistant.turn_start', 'start'),
      ...(outcome === 'failed'
        ? [event('session.error', 'error', { message: 'Request failed' })]
        : outcome === 'stopped'
          ? [event('abort', 'stop')]
          : [event('assistant.message', 'reply', { content: 'Reply', messageId: 'reply' })]),
      event('assistant.turn_end', 'end', { turnId: 'turn' })
    ]
    const instance = configure(
      adapter(
        './copilot/CopilotProviderAdapter.ts',
        ['getChats', 'createChatFromMetadata', 'getSidebarTurnSummary', 'createChatDetail'],
        {
          ...bindings,
          ...copilot,
          normalizeContainerTarget: () => ({ kind: 'host' }),
          toMilliseconds: (value) => (value === undefined ? 0 : new Date(value).getTime()),
          copilotOneShotClientName: 'one-shot'
        }
      )
    )
    const client = {
      rpc: {
        sessions: {
          list: async () => ({
            sessions: [{ sessionId: 'chat', summary: 'Chat', startTime: 1000, modifiedTime: 2000 }]
          }),
          readPersistedEvents: async (params) => {
            assert.equal(params.direction, 'backward')
            assert.equal(params.max, 64)
            return { events, hasMore: false, cursor: 'end', cursorStatus: 'ok' }
          }
        }
      }
    }
    instance.ensureClient = async () => client
    const state = { ...common, events }
    return {
      list: () => instance.getChats(),
      open: () => {
        instance.states.set('chat', state)
        return instance.createChatDetail(state)
      }
    }
  }
  if (provider === 'opencode') {
    const error =
      outcome === 'failed'
        ? { name: 'APIError', data: { message: 'Request failed' } }
        : outcome === 'stopped'
          ? { name: 'MessageAbortedError' }
          : undefined
    const messages = [
      user('old-user'),
      reply('old-error', { name: 'APIError' }),
      user('user'),
      reply('reply', error)
    ]
    const session = {
      id: 'chat',
      directory: '/repo',
      title: 'Chat',
      time: { created: 1000, updated: 2000 }
    }
    const instance = configure(
      adapter(
        './opencode/OpenCodeProviderAdapter.ts',
        ['getChats', 'createChat', 'getChatStatus', 'createChatDetailFromState'],
        {
          ...bindings,
          ...opencode,
          ...opencodeV2,
          isDefaultOpenCodeTitle,
          getOpenCodeUsageLimitMessage,
          requireData: (value) => value.data,
          isOneShotSession: () => false,
          getMessagePreview: () => ''
        }
      )
    )
    const state = { ...common, messages, session, messagesHydrated: false }
    Object.assign(instance, {
      getClientEntry: async () => ({
        container: null,
        client: {
          experimental: { session: { list: async () => ({ data: [session] }) } },
          session: {
            status: async () => ({ data: {} }),
            messages: async () => ({ data: messages, response: new Response() })
          }
        }
      }),
      rememberSession: () => state,
      loadMessages: async () => messages
    })
    return {
      list: () => instance.getChats(),
      open: () => instance.createChatDetailFromState(state)
    }
  }
  const turn = (id, status) => ({
    id,
    status,
    items: [{ type: 'userMessage', id: `${id}-user`, content: [{ type: 'text', text: 'Request' }] }]
  })
  const turns = [
    turn('old', 'failed'),
    turn(
      'latest',
      outcome === 'failed' ? 'failed' : outcome === 'stopped' ? 'interrupted' : 'completed'
    )
  ]
  const thread = {
    id: 'chat',
    preview: '',
    createdAt: 1,
    updatedAt: 2,
    turns,
    status: { type: 'notLoaded' }
  }
  const instance = configure(
    adapter(
      './codex/CodexProviderAdapter.ts',
      ['getChatsInContext', 'getSidebarTurnSummary', 'createChatDetail'],
      {
        ...bindings,
        ...codex,
        getCodexTurnOutcome,
        isCodexSubagentThread: () => false,
        loadSessionThreadNames: async () => new Map(),
        getThreadTitle: () => 'Chat',
        getThreadApiCwd: () => '/repo',
        ...codexStatuses,
        assertReadableCodexHistory() {},
        isLegacyCodexHistory: () => false,
        codexCapabilities: {}
      }
    )
  )
  Object.assign(instance, {
    threadListScanClients: new WeakSet(),
    withResolvedThreadName: (value) => value,
    rememberThreadContainer() {},
    getProviderPendingApproval: () => null,
    getProviderPendingUserInput: () => null,
    getCurrentContainer: () => null,
    getRenderableTurns: (thread) => thread.turns,
    getProviderPendingMessages: () => [],
    getThreadSubagents: () => [],
    threadRevisions: new Map(),
    threadContainers: new Map(),
    contextUsageByThread: new Map(),
    goals: new Map(),
    externallyOwnedThreadIds: new Set(),
    writeAccessChecks: new Set(),
    pendingTurnStarts: new Set(),
    pendingTurnIds: new Map(),
    userQuestions: { hasBlocking: () => false, getPending: () => null },
    client: {
      request: async (method) =>
        method === 'thread/list' ? { data: [thread], nextCursor: null } : { data: [turns.at(-1)] }
    }
  })
  return {
    list: () => instance.getChatsInContext(),
    open: () => instance.createChatDetail(thread),
    thread,
    instance
  }
}

test('Codex sidebar refresh agrees with terminal turns despite stale active metadata', async () => {
  for (const outcome of ['stopped', 'failed', null]) {
    for (const activeFlags of [[], ['waitingOnApproval'], ['waitingOnUserInput']]) {
      const fixture = coldFixture('codex', outcome)
      fixture.thread.status = { type: 'active', activeFlags }
      for (let refresh = 0; refresh < 2; refresh++) {
        const [listed] = (await fixture.list()).chats
        const opened = fixture.open()
        assert.equal(listed.status, null)
        assert.equal(listed.status, opened.status)
        assert.equal(listed.lastTurnOutcome, outcome)
        assert.equal(listed.lastTurnOutcome, opened.lastTurnOutcome)
      }
    }
  }
})

test('Codex sidebar keeps live turns and local submissions active', async () => {
  for (const type of ['notLoaded', 'idle', 'active']) {
    const fixture = coldFixture('codex', 'stopped')
    fixture.thread.status = { type, activeFlags: [] }
    fixture.thread.turns.at(-1).status = 'inProgress'
    const [listed] = (await fixture.list()).chats
    assert.equal(listed.status, 'active')
    assert.equal(listed.lastTurnOutcome, null)
  }
  for (const pending of ['pendingTurnStarts', 'pendingTurnIds']) {
    const fixture = coldFixture('codex', 'stopped')
    fixture.instance[pending] = new Map([['chat', 'new-turn']])
    const [listed] = (await fixture.list()).chats
    assert.equal(listed.status, 'active')
    assert.equal(listed.lastTurnOutcome, null)
  }
  for (const flag of ['waitingOnApproval', 'waitingOnUserInput']) {
    const fixture = coldFixture('codex', null)
    fixture.thread.status = { type: 'active', activeFlags: [flag] }
    fixture.thread.turns.at(-1).status = 'inProgress'
    assert.equal((await fixture.list()).chats[0].status, flag)
  }
})

test('Codex restart and ownership metadata refreshes preserve the last conversation activity time', async () => {
  const seenUpdatedAt = 4000
  for (let restart = 0; restart < 3; restart++) {
    const fixture = coldFixture('codex', 'failed')
    // Resuming an old chat touches thread metadata, but does not add another reply.
    fixture.thread.updatedAt = 100 + restart
    Object.assign(fixture.thread.turns.at(-1), { startedAt: 2, completedAt: 3 })
    const [chat] = await enrich({ seenUpdatedAt })((await fixture.list()).chats)
    assert.equal(chat.updatedAt, 3000)
    assert.equal(fixture.open().updatedAt, chat.updatedAt)
    assert.ok(chat.updatedAt <= chat.seenUpdatedAt)

    fixture.thread.turns.at(-1).completedAt = 110 + restart
    const [completed] = await enrich({ seenUpdatedAt })((await fixture.list()).chats)
    assert.ok(completed.updatedAt > completed.seenUpdatedAt)
    assert.equal(fixture.open().updatedAt, completed.updatedAt)
  }
})

for (const provider of ['codex', 'claude', 'copilot', 'opencode']) {
  for (const outcome of ['failed', 'stopped', null]) {
    test(`${provider}: ${outcome ?? 'successful'} last turn has the same outcome on startup, read, reopen and restart`, async () => {
      for (const seenUpdatedAt of [null, 3000]) {
        const enrichChats = enrich({ seenUpdatedAt })
        for (let restart = 0; restart < 2; restart++) {
          const fixture = coldFixture(provider, outcome)
          const [cold] = await enrichChats((await fixture.list()).chats)
          assert.equal(cold.lastTurnOutcome, outcome)
          assert.equal(getLastTurnOutcome(fixture.open()), outcome)
          const [reopened] = await enrichChats((await fixture.list()).chats)
          assert.equal(reopened.lastTurnOutcome, outcome)
          assert.equal(reopened.seenUpdatedAt, seenUpdatedAt)
        }
      }
    })
  }
}
