import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { OpenCodeHistoryPages } from './OpenCodeHistoryPages.ts'
import { forEachOpenCodeHistoryMessage, loadOpenCodeMessages } from './OpenCodeHistory.ts'
import * as renderers from './OpenCodeItemRenderers.ts'
import { reconcileOpenCodeMessageSnapshot, applyOpenCodeMessageEvent } from './OpenCodeEvents.ts'
import { reconcileProviderRecords } from '../ProviderConversationEngine.ts'
import { getProviderChatTurns, sliceProviderChatTurns } from '../../../shared/chatTurns.ts'
import { isDefaultOpenCodeTitle } from './OpenCodeChatTitle.ts'
import { getOpenCodeUsageLimitMessage } from './OpenCodeUsageLimit.ts'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerTarget.ts'

const user = (i) => ({
  info: { id: `msg-${String(i).padStart(5, '0')}-0`, role: 'user', time: { created: i * 100 } },
  parts: [{ id: `prompt${i}`, type: 'text', text: `Prompt ${i}` }]
})
const answer = (i) => ({
  info: {
    id: `msg-${String(i).padStart(5, '0')}-1`,
    role: 'assistant',
    time: { created: i * 100 + 1, completed: i * 100 + 2 },
    finish: 'stop'
  },
  parts: [{ id: `answer${i}`, type: 'text', text: `Answer ${i}` }]
})
const records = (count) => Array.from({ length: count }, (_, i) => [user(i), answer(i)]).flat()
const transport = (history) => {
  const requests = []
  const hooks = {}
  let bytes = 0
  const session = {
    id: 'chat',
    directory: '/fixture',
    title: 'Saved title',
    time: { created: 1, updated: 2 }
  }
  const client = createOpencodeClient({
    baseUrl: 'http://fixture.test',
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === '/experimental/session') return Response.json([session])
      if (url.pathname === '/session/chat') return Response.json(session)
      if (url.pathname === '/session/status') return Response.json({})
      if (url.pathname === '/permission' || url.pathname === '/question') return Response.json([])
      if (url.pathname.startsWith('/session/chat/message/')) {
        const id = decodeURIComponent(url.pathname.split('/').at(-1))
        const record = history.find((message) => message.info.id === id)
        if (!record) throw new Error('OpenCode history changed. Reopen the conversation.')
        return Response.json(record)
      }
      assert.equal(url.pathname, '/session/chat/message')
      const limit = Number(url.searchParams.get('limit'))
      const before = url.searchParams.get('before')
      const end = before
        ? history.findIndex((record) => `opaque:${record.info.id}` === before)
        : history.length
      assert.ok(end >= 0, 'only server-issued opaque cursors may be sent')
      const start = Math.max(0, end - limit)
      const body = JSON.stringify(history.slice(start, end))
      bytes += Buffer.byteLength(body)
      requests.push({ before, limit, start, end })
      await hooks.beforeResponse?.()
      return new Response(body, {
        headers: {
          'content-type': 'application/json',
          ...(start ? { 'x-next-cursor': `opaque:${history[start].info.id}` } : {})
        }
      })
    }
  })
  return {
    client,
    requests,
    session,
    history,
    hooks,
    get bytes() {
      return bytes
    }
  }
}
const source = ts.createSourceFile(
  'adapter.ts',
  readFileSync(new URL('./OpenCodeProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (n) => ts.isClassDeclaration(n) && n.name.text === 'OpenCodeProviderAdapter'
)
const selected = new Set([
  'getOrCreateState',
  'rememberSession',
  'findSession',
  'ensureState',
  'refreshState',
  'refreshStateNow',
  'loadMessages',
  'getChatWindow',
  'getChatCursorWindow',
  'getChatWindowForItem',
  'createChatDetailFromState',
  'getChatStatus'
])
const code = ts.transpileModule(
  `class Harness { ${declaration.members
    .filter((m) => selected.has(m.name?.getText(source)))
    .map((m) => m.getText(source))
    .join('\n')}
}; globalThis.Harness=Harness`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText
const harness = (history = records(1000)) => {
  const t = transport(history)
  const context = vm.createContext({
    ...renderers,
    console,
    Date,
    getContainerTargetKey,
    normalizeStoredContainer: normalizeContainerTarget,
    getProviderChatTurns,
    sliceProviderChatTurns,
    isDefaultOpenCodeTitle,
    loadOpenCodeMessages,
    forEachOpenCodeHistoryMessage,
    reconcileOpenCodeMessageSnapshot,
    reconcileProviderRecords,
    getOpenCodeUsageLimitMessage,
    requireData: (result) => result.data,
    getPendingApproval: () => null,
    getPendingUserInput: () => null
  })
  vm.runInContext(code, context)
  const instance = Object.assign(new context.Harness(), {
    states: new Map(),
    sessionContainers: new Map(),
    sessionDiscoveries: new Map(),
    refreshes: new WeakMap(),
    stateChecks: new WeakMap(),
    historyPages: new OpenCodeHistoryPages(),
    pendingMessageStore: { restore: async () => [] },
    restorePendingMessages() {},
    persistPendingMessages() {},
    getClientEntry: async () => ({ client: t.client, container: null }),
    closeBrowser() {},
    getContextUsage: () => null,
    reportMessageTokenUsage() {},
    scheduleUpdate() {}
  })
  return { ...t, transport: t, instance }
}

test('cold opening and scrolling use real SDK pages without loading unrelated history', async () => {
  const h = harness(),
    a = h.instance
  const latest = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.equal(latest.items[0].id, user(996).info.id)
  assert.equal(latest.turnPagination.kind, 'cursor')
  assert.equal(h.requests.length, 1)
  assert.ok(h.transport.bytes < 5000)
  const tail = a.states.get('chat').messages
  const older = await a.getChatCursorWindow('chat', {
    cursor: latest.turnPagination.olderCursor,
    direction: 'older',
    limit: 10
  })
  assert.equal(older.items[0].id, user(992).info.id)
  const newer = await a.getChatCursorWindow('chat', {
    cursor: older.turnPagination.newerCursor,
    direction: 'newer',
    limit: 10
  })
  assert.deepEqual(newer.items, latest.items)
  assert.equal(a.states.get('chat').messages, tail, 'scrolling must not replace the live tail')
  const jump = await a.getChatWindowForItem('chat', 'answer990', 10)
  assert.ok(jump.items.some((item) => item.id === 'answer990'))
  assert.ok(h.requests.every((r) => r.limit <= 8))
})

test('cursor pages reconstruct all turns exactly across native pages and long tool loops', async () => {
  const history = records(21)
  const loop = Array.from({ length: 27 }, (_, i) => ({
    ...answer(`loop${i}`),
    info: { ...answer(3).info, id: `loop${i}`, finish: 'tool-calls' }
  }))
  history.splice(7, 0, ...loop)
  const t = transport(history),
    pages = new OpenCodeHistoryPages()
  let page = await pages.read(t.client, t.session, { cursor: null, direction: 'older', limit: 3 })
  let recovered = page.messages
  let reads = 0
  while (page.pagination.olderCursor) {
    assert.ok(++reads < 30)
    page = await pages.read(t.client, t.session, {
      cursor: page.pagination.olderCursor,
      direction: 'older',
      limit: 3
    })
    assert.equal(page.messages[0].info.role, 'user', 'pages must start on complete turn boundaries')
    recovered = [...page.messages, ...recovered]
  }
  assert.deepEqual(recovered, history)
  assert.equal(new Set(recovered.map((m) => m.info.id)).size, history.length)
})

test('exports read all history without replacing the retained tail or its cursors', async () => {
  const h = harness(),
    a = h.instance
  const latest = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  const state = a.states.get('chat'),
    tail = state.messages
  const exported = await a.getChatWindow('chat', { startIndex: 0, limit: Number.MAX_SAFE_INTEGER })
  assert.equal(getProviderChatTurns(exported.items).length, 1000)
  assert.equal(exported.turnPagination, undefined)
  assert.equal(state.messages, tail)
  assert.deepEqual(state.historyPagination, latest.turnPagination)
})

test('opening a different page size and refreshing external appends stay bounded', async () => {
  const h = harness(),
    a = h.instance
  await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  const one = await a.getChatWindow('chat', { startIndex: null, limit: 1 })
  assert.equal(getProviderChatTurns(one.items).length, 1)
  h.history.push(user(1000), answer(1000))
  h.session.time.updated++
  const refreshed = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.ok(refreshed.items.some((item) => item.id === 'answer1000'))
  assert.ok(h.requests.every((r) => r.limit <= 8))
})

test('live publications retain the whole tail and paging back to it includes streamed turns', async () => {
  const h = harness(),
    a = h.instance
  const latest = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  const state = a.states.get('chat')
  const older = await a.getChatCursorWindow('chat', {
    cursor: latest.turnPagination.olderCursor,
    direction: 'older',
    limit: 10
  })
  for (let i = 1000; i < 1012; i++) {
    h.history.push(user(i), answer(i))
    state.messages = applyOpenCodeMessageEvent(state.messages, 'message.updated', {
      info: user(i).info
    })
    state.messages = applyOpenCodeMessageEvent(state.messages, 'message.part.updated', {
      part: {
        ...user(i).parts[0],
        messageID: user(i).info.id,
        sessionID: 'chat'
      }
    })
    state.messages = applyOpenCodeMessageEvent(state.messages, 'message.updated', {
      info: answer(i).info
    })
  }
  const update = a.createChatDetailFromState(state, { startIndex: null, limit: 10 })
  assert.equal(
    update.items[0].id,
    user(996).info.id,
    'a fixed viewport must not cut off the retained cursor anchor'
  )
  assert.equal(getProviderChatTurns(update.items).length, 16)
  const newer = await a.getChatCursorWindow('chat', {
    cursor: older.turnPagination.newerCursor,
    direction: 'newer',
    limit: 10
  })
  assert.equal(newer.items[0].id, user(996).info.id)
  assert.equal(getProviderChatTurns(newer.items).length, 16)
})

test('history cursors reject cross-session reuse and missing boundaries', async () => {
  const t = transport(records(20).slice(0, -1)),
    pages = new OpenCodeHistoryPages()
  const page = await pages.read(t.client, t.session, {
    cursor: null,
    direction: 'older',
    limit: 10
  })
  await assert.rejects(
    pages.read(
      t.client,
      { ...t.session, id: 'other' },
      {
        cursor: page.pagination.olderCursor,
        direction: 'older',
        limit: 10
      }
    ),
    /cursor expired/
  )
  t.history.splice(
    t.history.findIndex((m) => m.info.id === answer(15).info.id),
    1
  )
  await assert.rejects(
    pages.read(t.client, t.session, {
      cursor: page.pagination.olderCursor,
      direction: 'older',
      limit: 10
    }),
    /history changed/
  )
})

test('a paginated refresh preserves streamed changes received while its HTTP page was in flight', async () => {
  const h = harness(),
    a = h.instance
  await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  const state = a.states.get('chat')
  state.messagesDirty = true
  h.hooks.beforeResponse = () => {
    delete h.hooks.beforeResponse
    state.messages = applyOpenCodeMessageEvent(state.messages, 'message.part.delta', {
      messageID: answer(999).info.id,
      partID: 'answer999',
      field: 'text',
      delta: ' live'
    })
    state.eventRevision++
    state.active = true
  }
  const detail = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  assert.ok(detail.items.some((item) => item.content === 'Answer 999 live'))
  assert.equal(state.active, true, 'an older status snapshot must not end the live turn')
  assert.ok(h.requests.every((r) => r.limit <= 8))
})

test('hidden compaction records do not split a turn across history pages', async () => {
  const history = records(12)
  history.splice(
    13,
    0,
    {
      info: { id: 'compaction', role: 'user', time: { created: 650 } },
      parts: [{ type: 'compaction', id: 'compact' }]
    },
    {
      info: { ...answer(6).info, id: 'summary', summary: true },
      parts: [{ type: 'text', id: 'summary-text', text: 'Internal summary' }]
    }
  )
  const t = transport(history),
    pages = new OpenCodeHistoryPages()
  let page = await pages.read(t.client, t.session, { cursor: null, direction: 'older', limit: 2 })
  let recovered = page.messages
  while (page.pagination.olderCursor) {
    page = await pages.read(t.client, t.session, {
      cursor: page.pagination.olderCursor,
      direction: 'older',
      limit: 2
    })
    recovered = [...page.messages, ...recovered]
  }
  assert.deepEqual(recovered, history)
})

test('older cursors stay anchored after many live appends, including a native page overlap', async () => {
  // An odd record count makes the first response start on an assistant from an older turn.
  const original = records(20).slice(0, -1)
  const t = transport([...original]),
    pages = new OpenCodeHistoryPages()
  let page = await pages.read(t.client, t.session, { cursor: null, direction: 'older', limit: 10 })
  let recovered = page.messages
  t.history.push(answer(19), ...records(30).slice(40))
  while (page.pagination.olderCursor) {
    page = await pages.read(t.client, t.session, {
      cursor: page.pagination.olderCursor,
      direction: 'older',
      limit: 10
    })
    recovered = [...page.messages, ...recovered]
  }
  assert.deepEqual(recovered, original)
})

test('returning from an older page after an external append preserves every intervening turn', async () => {
  const h = harness(),
    a = h.instance
  const latest = await a.getChatWindow('chat', { startIndex: null, limit: 10 })
  const older = await a.getChatCursorWindow('chat', {
    cursor: latest.turnPagination.olderCursor,
    direction: 'older',
    limit: 10
  })
  h.history.push(...records(1020).slice(2000))
  h.session.time.updated++
  const newer = await a.getChatCursorWindow('chat', {
    cursor: older.turnPagination.newerCursor,
    direction: 'newer',
    limit: 10
  })
  assert.equal(newer.items[0].id, user(996).info.id)
  assert.equal(getProviderChatTurns(newer.items).length, 24)
  assert.ok(newer.items.some((item) => item.id === 'answer1019'))
})
