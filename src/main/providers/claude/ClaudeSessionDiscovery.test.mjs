import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Test transport lifecycle independently of Electron's bundler-only worker import.
const source = ts.createSourceFile(
  'ClaudeSessionDiscovery.ts',
  readFileSync(new URL('./ClaudeSessionDiscovery.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find((node) => ts.isClassDeclaration(node))
const compiled = ts.transpile(
  ts
    .createPrinter()
    .printNode(ts.EmitHint.Unspecified, declaration, source)
    .replace('export class', 'class'),
  { target: ts.ScriptTarget.ES2022 }
)
const makeDiscovery = () => {
  const workers = []
  class FakeWorker extends EventEmitter {
    messages = []
    postMessage(message) {
      this.messages.push(message)
    }
    unref() {}
    terminate() {
      this.emit('exit', 0)
      return Promise.resolve(0)
    }
  }
  const Discovery = new Function(
    'createWorker',
    'getContainerTargetKey',
    'getHostCommand',
    `${compiled}; return ClaudeSessionDiscovery`
  )(
    () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    (container) => container?.name ?? 'host',
    async (_file, args) => ({ file: 'sh', args })
  )
  return { discovery: new Discovery(), workers }
}
const complete = (worker, page) => {
  const request = worker.messages.findLast((message) => message.type === 'list')
  worker.emit('message', { type: 'result', id: request.id, page })
}

test('coalesces identical pages and sends pagination and scope to the worker', async () => {
  const { discovery, workers } = makeDiscovery()
  const first = discovery.list(null, null, 2, ['hidden'])
  assert.equal(discovery.list(null, null, 2, ['hidden']), first)
  const worker = workers[0]
  assert.equal(worker.messages.length, 1)
  assert.deepEqual(worker.messages[0], {
    type: 'list',
    id: 1,
    scope: 'host',
    remote: false,
    cursor: null,
    limit: 2,
    hiddenSessionIds: ['hidden']
  })
  const page = { sessions: [{ sessionId: 'old' }], nextCursor: 'next' }
  complete(worker, page)
  assert.deepEqual(await first, page)
  const next = discovery.list(null, 'next', 2)
  assert.equal(worker.messages.at(-1).cursor, 'next')
  complete(worker, { sessions: [], nextCursor: null })
  await next
  const refresh = discovery.list(null, null, 2)
  assert.equal(worker.messages.length, 3, 'a refresh requests fresh metadata')
  complete(worker, { sessions: [{ sessionId: 'new' }], nextCursor: null })
  assert.equal((await refresh).sessions[0].sessionId, 'new')
  discovery.dispose()
})

test('different environments can have discovery in flight together', async () => {
  const { discovery, workers } = makeDiscovery()
  const remote = discovery.list({ name: 'remote' })
  const local = discovery.list(null)
  assert.equal(workers[0].messages.length, 2)
  complete(workers[0], { sessions: [{ sessionId: 'local' }], nextCursor: null })
  assert.equal((await local).sessions[0].sessionId, 'local')
  workers[0].emit('message', { type: 'result', id: 1, page: { sessions: [], nextCursor: null } })
  await remote
  discovery.dispose()
})

test('worker failure rejects pending requests and a later request can recover', async () => {
  const { discovery, workers } = makeDiscovery()
  const failed = discovery.list(null)
  workers[0].emit('error', new Error('worker crashed'))
  await assert.rejects(failed, /worker crashed/)
  const retry = discovery.list(null)
  assert.equal(workers.length, 2)
  // A late exit from the old worker must not reject the retry.
  workers[0].emit('exit', 1)
  complete(workers[1], { sessions: [], nextCursor: null })
  assert.deepEqual(await retry, { sessions: [], nextCursor: null })
  discovery.dispose()
})

test('disposal rejects pending requests and cannot respawn discovery', async () => {
  const { discovery, workers } = makeDiscovery()
  const pending = discovery.list({ name: 'remote' })
  discovery.dispose()
  await assert.rejects(pending, /disposed/)
  await assert.rejects(discovery.list(null), /disposed/)
  assert.equal(workers.length, 1)
})

test('adapter forwards opaque cursors, page size and hidden IDs directly to discovery', async () => {
  const adapterSource = ts.createSourceFile(
    'ClaudeProviderAdapter.ts',
    readFileSync(new URL('./ClaudeProviderAdapter.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const adapter = adapterSource.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'ClaudeProviderAdapter'
  )
  const getChats = adapter.members.find((node) => node.name?.getText(adapterSource) === 'getChats')
  const javascript = ts.transpile(
    `const getChats = ${getChats.initializer.getText(adapterSource)}`,
    { target: ts.ScriptTarget.ES2022 }
  )
  const createMethod = new Function(
    'normalizeContainerTarget',
    'isStoredContainer',
    `${javascript}; return getChats`
  )
  const calls = []
  const container = { kind: 'container', name: 'remote' }
  const sessions = [{ sessionId: 'selected' }]
  const state = {
    hiddenSessionIds: new Set(['hidden']),
    sessionContainers: new Map(),
    sessionMetadata: new Map(),
    sessionDiscovery: {
      list: async (...args) => {
        calls.push(args)
        return { sessions, nextCursor: 'opaque-next' }
      }
    },
    createChatFromMetadata: (session) => ({ id: session.sessionId })
  }
  const method = createMethod.call(
    state,
    (value) => value,
    () => true
  )
  const page = await method.call(state, { container, cursor: 'opaque-current', limit: 2 })
  assert.deepEqual(calls, [[container, 'opaque-current', 2, ['hidden']]])
  assert.deepEqual(page, { chats: [{ id: 'selected' }], nextCursor: 'opaque-next' })
  assert.equal(state.sessionMetadata.get('selected'), sessions[0])
  assert.equal(state.sessionContainers.get('selected'), container)
})
