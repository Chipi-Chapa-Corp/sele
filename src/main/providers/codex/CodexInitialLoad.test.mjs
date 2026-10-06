import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { loadCodexTurnCursorWindow } from './CodexPaginatedHistory.ts'

const source = ts.createSourceFile(
  'CodexProviderAdapter.ts',
  readFileSync(new URL('./CodexProviderAdapter.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexProviderAdapter'
)
const code = ts.transpile(
  `class Harness { ${declaration.members
    .filter((node) =>
      ['getChat', 'loadChatCursorWindowInContext'].includes(node.name?.getText(source))
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
  const publications = []
  const turns = Array.from({ length: 10 }, (_, index) => ({
    id: `turn-${index}`,
    status: 'completed',
    items: []
  }))
  const adapter = vm.runInNewContext(code, {
    loadCodexTurnCursorWindow,
    isLegacyCodexHistory: () => false,
    assertSupportedCodexHistory: () => {},
    rendererChatUpdateTurnLimit: 10,
    getContainerTargetKey: () => 'host'
  })
  Object.assign(adapter, {
    threads: new Map(),
    threadRevisions: new Map(),
    runWithContainer: (_container, run) => run(),
    getThreadContainer: () => null,
    rememberThreadContainer: () => {},
    readThread: async (_id, includeTurns) => {
      assert.equal(includeTurns, false)
      return {
        thread: {
          id: 'chat',
          path: '/rollout',
          historyMode: 'paginated',
          preview: 'Saved chat',
          turns: []
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
    resolveThreadName: async () => 'Saved chat',
    resolveThreadCwd: async () => '/repo',
    cacheThread: (thread) => adapter.threads.set(thread.id, thread),
    loadTranscriptMetadata: () => metadata,
    goals: { read: async () => {} },
    createChatDetail: (thread, options) => ({
      id: thread.id,
      items: [...thread.turns, ...(options.cursorPendingMessages ?? [])]
    }),
    checkChatWriteAccessInBackground: () => {},
    getCachedChatDetail: () => null,
    scheduleChatUpdated: (id) => publications.push(id),
    scheduleQueueDrain() {}
  })
  return { adapter, finishMetadata, requests, publications }
}

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
