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
const complete = (worker, sessions) => {
  const request = worker.messages.findLast((message) => message.type === 'list')
  worker.emit('message', { type: 'result', id: request.id, sessions })
}

test('coalesces discovery and reuses pages but refreshes first-page metadata', async () => {
  const { discovery, workers } = makeDiscovery()
  const first = discovery.list(null)
  assert.equal(discovery.list(null), first)
  assert.equal(workers[0].messages.length, 1)
  complete(workers[0], [{ sessionId: 'old' }])
  assert.deepEqual(await first, [{ sessionId: 'old' }])
  assert.deepEqual(await discovery.list(null, true), [{ sessionId: 'old' }])
  assert.equal(workers[0].messages.length, 1)
  const refresh = discovery.list(null)
  assert.equal(
    discovery.list(null, true),
    refresh,
    'pages join a fresh listing rather than using a stale snapshot'
  )
  complete(workers[0], [{ sessionId: 'new' }])
  assert.deepEqual(await refresh, [{ sessionId: 'new' }])
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
  complete(workers[1], [])
  assert.deepEqual(await retry, [])
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
