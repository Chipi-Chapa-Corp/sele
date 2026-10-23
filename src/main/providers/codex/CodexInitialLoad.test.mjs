import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import {
  isLegacyCodexHistory,
  isUnsupportedTurnPaginationError,
  loadCodexFullThread,
  loadCodexLegacyThread,
  loadCodexTurnCursorWindow
} from './CodexPaginatedHistory.ts'

const source = ts.createSourceFile(
  'CodexProviderAdapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
// Persistence of queued and steering messages is covered by PendingMessageRestore.test.mjs.
const code = ts.transpile(
  `class Harness { pendingMessageRestores = new Map(); persistPendingMessages() {} startPendingMessageRestore() {}  ${declaration.members
    .filter((node) =>
      [
        'getChat',
        'getChatWindowInContext',
        'getChatWindowForItem',
        'loadFullThread',
        'loadLegacyThread',
        'loadThreadWithoutPagination',
        'loadChatCursorWindowInContext',
        'usesLegacyHistory',
        'loadLegacyChatWindowInContext'
      ].includes(node.name?.getText(source))
    )
    .map((node) => node.getText(source))
    .join('\n')} }; new Harness()`,
  { target: ts.ScriptTarget.ES2022 }
)

const fixture = () => {
  let finishMetadata
  const metadata = new Promise((resolve) => {
    finishMetadata = resolve
  })
  const requests = []
  const reads = []
  const publications = []
  const turns = Array.from({ length: 10 }, (_, index) => ({
    id: `turn-${index}`,
    status: 'completed',
    items: []
  }))
  const adapter = vm.runInNewContext(code, {
    loadCodexTurnCursorWindow,
    loadCodexFullThread,
    loadCodexLegacyThread,
    isLegacyCodexHistory,
    isUnsupportedTurnPaginationError,
    assertSupportedCodexHistory: () => {},
    assertReadableCodexHistory: () => {},
    rendererChatUpdateTurnLimit: 10,
    getContainerTargetKey: () => 'host'
  })
  Object.assign(adapter, {
    threads: new Map(),
    threadRevisions: new Map(),
    runWithContainer: (_container, run) => run(),
    getThreadContainer: () => null,
    rememberThreadContainer: () => {},
    readThread: async (id, includeTurns) => {
      reads.push({ id, includeTurns })
      return {
        thread: {
          id,
          path: '/rollout',
          historyMode: 'paginated',
          preview: 'Saved chat',
          turns: includeTurns ? [...turns] : []
        }
      }
    },
    client: {
      request: async (method, params) => {
        requests.push({ method, ...params })
        return { data: [...turns].reverse(), nextCursor: 'older', backwardsCursor: null }
      }
    },
    getProviderPendingMessages: () => [],
    attachSubmittedUserMessages: async (_id, items) => items,
    filterRolledBackTurns: (_id, items) => items,
    getRenderableTurns: (thread) => thread.turns,
    hydrateFullThread: async (thread) => thread,
    resolveThreadName: async () => 'Saved chat',
    resolveThreadCwd: async () => '/repo',
    cacheThread: (thread) => adapter.threads.set(thread.id, thread),
    loadTranscriptMetadata: () => metadata,
    goals: { read: async () => {} },
    createChatDetail: (thread, options) => {
      const start =
        options.turnWindow?.startIndex ??
        Math.max(0, thread.turns.length - (options.turnWindow?.limit ?? thread.turns.length))
      const end = start + (options.turnWindow?.limit ?? thread.turns.length)
      return {
        id: thread.id,
        items: [...thread.turns.slice(start, end), ...(options.cursorPendingMessages ?? [])]
      }
    },
    checkChatWriteAccessInBackground: () => {},
    getCachedChatDetail: () => null,
    scheduleChatUpdated: (id) => publications.push(id),
    scheduleQueueDrain() {}
  })
  return { adapter, finishMetadata, requests, reads, publications }
}

test('pagination rejection falls back for the first open, another chat, and retries', async () => {
  const { adapter, requests, reads } = fixture()
  adapter.client.request = async (method) => {
    requests.push(method)
    throw new Error('list_turns is not supported yet')
  }
  // The failed native read must not reuse a previously cached partial transcript.
  adapter.threads.set('chat', {
    id: 'chat',
    historyMode: 'paginated',
    preview: 'Saved chat',
    turns: [{ id: 'partial-tail', items: [] }]
  })

  for (const id of ['chat', 'other-chat', 'other-chat']) {
    adapter.threads.delete('other-chat')
    const detail = await adapter.getChat(id)
    assert.equal(detail.id, id)
    assert.deepEqual(
      Array.from(detail.items, (item) => item.id),
      Array.from({ length: 10 }, (_, index) => `turn-${index}`)
    )
  }
  assert.equal(adapter.turnPaginationUnsupported, true)
  assert.deepEqual(requests, ['thread/turns/list'])
  assert.deepEqual(
    reads.filter((read) => read.includeTurns).map((read) => read.id),
    ['chat', 'other-chat', 'other-chat']
  )
})

test('indexed and item history reads use full transcripts after pagination is rejected', async () => {
  const { adapter, requests, reads } = fixture()
  adapter.turnPaginationUnsupported = true
  const indexed = await adapter.getChatWindowInContext('indexed', { startIndex: 0, limit: 3 })
  assert.deepEqual(
    Array.from(indexed.items, (item) => item.id),
    ['turn-0', 'turn-1', 'turn-2']
  )

  const item = await adapter.getChatWindowForItem('item', 'turn-4:message', 3)
  assert.deepEqual(
    Array.from(item.items, (item) => item.id),
    ['turn-3', 'turn-4', 'turn-5']
  )
  assert.deepEqual(requests, [])
  assert.deepEqual(
    reads.filter((read) => read.includeTurns).map((read) => read.id),
    ['indexed', 'item']
  )
})

test('true legacy chats keep using the legacy reader', async () => {
  const { adapter, reads } = fixture()
  const readThread = adapter.readThread
  adapter.readThread = async (...args) => {
    const response = await readThread(...args)
    response.thread.historyMode = 'legacy'
    return response
  }
  // A broad full-reader replacement must not bypass the legacy validation path.
  adapter.loadFullThread = () => assert.fail('legacy chats must use the legacy reader')
  const detail = await adapter.getChat('legacy')
  assert.equal(detail.items.length, 10)
  assert.equal(reads.filter((read) => read.includeTurns).length, 1)
})

test('first chat open returns ten native turns while cold metadata is still pending', async () => {
  const { adapter, finishMetadata, requests, publications } = fixture()
  let detail
  const opening = adapter.getChat('chat').then((result) => {
    detail = result
  })
  try {
    await setImmediate()
    assert.equal(detail?.items.length, 10, 'optional metadata must not block first detail')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'thread/turns/list')
    assert.equal(requests[0].itemsView, 'full')
    assert.equal(requests[0].limit, 10)
    assert.deepEqual(publications, [])
  } finally {
    finishMetadata(true)
    await opening
  }
  await setImmediate()
  assert.deepEqual(publications, ['chat'])
})

test('explicit historical pages still await their enrichment before returning', async () => {
  const { adapter, finishMetadata, publications } = fixture()
  let returned = false
  const opening = adapter
    .loadChatCursorWindowInContext(
      'chat',
      {
        cursor: null,
        direction: 'older',
        limit: 10
      },
      false
    )
    .then(() => {
      returned = true
    })
  try {
    await setImmediate()
    assert.equal(returned, false)
  } finally {
    finishMetadata(true)
    await opening
  }
  assert.equal(returned, true)
  assert.deepEqual(publications, [])
})

test('a latest page cannot resurrect a queued message delivered while it was loading', async () => {
  const { adapter, finishMetadata } = fixture()
  let pending = [{ type: 'pendingMessage', id: 'queued', kind: 'queued' }]
  adapter.getProviderPendingMessages = () => pending
  const deliveredTurn = { id: 'delivered-turn', status: 'completed', items: [] }
  let finishPage
  adapter.client.request = () =>
    new Promise((resolve) => {
      finishPage = resolve
    })
  const opening = adapter.getChat('chat')
  await setImmediate()

  // Live delivery finishes after the request captured its queue, before history responds.
  pending = []
  adapter.threadRevisions.set('chat', 1)
  adapter.threads.set('chat', {
    id: 'chat',
    path: '/rollout',
    historyMode: 'paginated',
    turns: [deliveredTurn]
  })
  finishPage({ data: [deliveredTurn], nextCursor: null, backwardsCursor: null })
  try {
    const detail = await opening
    assert.deepEqual(
      Array.from(detail.items, (item) => item.id),
      ['delivered-turn']
    )
  } finally {
    finishMetadata(false)
  }
})
