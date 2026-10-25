import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'CodexAppServerClient.ts',
  readFileSync(new URL('./CodexAppServerClient.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true
)
const declaration = source.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CodexAppServerClient'
)
const code = ts.transpile(
  `${declaration.getText(source).replace('export class', 'class')}; new CodexAppServerClient({ kind: 'container' })`,
  { target: ts.ScriptTarget.ES2022 }
)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const brokenPipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })

// Use real Node streams so a failed write emits the asynchronous 'error' that
// escapes a synchronous try/catch. No Electron or real Codex process is launched.
const fixture = (t, { failInitialize = false } = {}) => {
  const children = []
  const logs = []
  const client = vm.runInNewContext(code, {
    Buffer,
    Error,
    process,
    setTimeout,
    clearTimeout,
    requestTimeoutMs: 1000,
    threadListRequestTimeoutMs: 1000,
    createInterface,
    console: { error: (...args) => logs.push(args) },
    getAppServerCommand: () => ({ command: 'fixture', args: [] }),
    getHostCommand: async () => ({ file: 'fixture', args: [], env: {} }),
    registerBrowserUseSession() {},
    removeBrowserUseSessions() {},
    CodexDynamicTools: class {
      specs = []
      clear() {}
    },
    spawn: () => {
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.exitCode = null
      child.kills = 0
      child.kill = () => {
        child.kills++
        return true
      }
      child.autoReply = true
      child.failure = children.length === 0 && failInitialize ? brokenPipe() : null
      child.stdin = new Writable({
        write(chunk, _encoding, callback) {
          if (child.failure) {
            setImmediate(() => callback(child.failure))
            return
          }
          const message = JSON.parse(chunk.toString())
          if (message.id && (child.autoReply || message.method === 'initialize'))
            queueMicrotask(() => {
              child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
            })
          callback()
        }
      })
      children.push(child)
      return child
    }
  })
  t.after(() => {
    client.dispose()
    for (const child of children) {
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
  })
  return { client, children, logs }
}

test('asynchronous EPIPE rejects all pending RPCs and releases the failed connection once', async (t) => {
  const { client, children, logs } = fixture(t)
  await client.request('model/list')
  const child = children[0]
  const stopped = []
  client.onStopped((error) => stopped.push(error))
  child.autoReply = false
  const controller = new AbortController()
  const waiting = client.request('account/read', {}, { signal: controller.signal })
  await tick()
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1)
  child.failure = brokenPipe()
  const writing = client.request('model/list')
  await Promise.all([
    assert.rejects(waiting, { code: 'EPIPE' }),
    assert.rejects(writing, { code: 'EPIPE' })
  ])
  assert.equal(client.connectionIdentity, null)
  assert.equal(client.pendingRequests.size, 0)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  assert.equal(child.kills, 1)
  assert.equal(stopped.length, 1)
  child.emit('close', 1)
  assert.equal(stopped.length, 1)
  assert.equal(
    logs.filter(([message]) => message === 'Codex app-server stopped unexpectedly').length,
    1
  )
})

test('late events from a failed process cannot stop or send notifications to its replacement', async (t) => {
  const { client, children } = fixture(t)
  await client.request('model/list')
  const old = children[0]
  old.failure = brokenPipe()
  await assert.rejects(client.request('model/list'), { code: 'EPIPE' })
  await client.request('model/list')
  const replacement = children[1]
  const notifications = []
  client.onNotification((notification) => notifications.push(notification))
  old.stderr.write('stale error')
  old.stdout.write(`${JSON.stringify({ method: 'thread/closed', params: { threadId: 'old' } })}\n`)
  old.emit('error', new Error('late child error'))
  old.emit('close', 1)
  assert.equal(client.connectionIdentity, replacement)
  assert.equal(client.stderr, '')
  assert.equal(notifications.length, 0)
  assert.equal(replacement.kills, 0)
  await client.request('model/list')
  assert.equal(children.length, 2)
})

test('a failed initialization cannot clear a restart triggered by the stopped listener', async (t) => {
  const { client, children } = fixture(t, { failInitialize: true })
  let restarting
  client.onStopped(() => {
    restarting = client.request('model/list')
  })
  await assert.rejects(client.request('model/list'), { code: 'EPIPE' })
  await restarting
  await client.request('model/list')
  assert.equal(children.length, 2)
  assert.equal(client.connectionIdentity, children[1])
})

test('late pipe errors after disposal are handled without stopping a replacement', async (t) => {
  const { client, children } = fixture(t)
  const stopped = []
  client.onStopped((error) => stopped.push(error))
  await client.request('model/list')
  const old = children[0]
  client.dispose()
  await client.request('model/list')
  old.stdin.destroy(brokenPipe())
  await tick()
  old.emit('close', 0)
  assert.equal(client.connectionIdentity, children[1])
  assert.equal(stopped.length, 0)
  await client.request('model/list')
})
