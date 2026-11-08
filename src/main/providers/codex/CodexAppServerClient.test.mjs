import { supportsLocalHostTools } from '../hostToolTarget.ts'
import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { PassThrough, Writable } from 'node:stream'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getCodexExecutableError, isCodexExecutableUnavailable } from './CodexExecutable.ts'

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
  `${declaration.getText(source).replace('export class', 'class')}; globalThis.Client = CodexAppServerClient; new CodexAppServerClient({ kind: 'container' })`,
  { target: ts.ScriptTarget.ES2022 }
)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const brokenPipe = () => Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })

// Use real Node streams so a failed write emits the asynchronous 'error' that
// escapes a synchronous try/catch. No Electron or real Codex process is launched.
const fixture = (t, { failInitialize = false, initializeResult = {} } = {}) => {
  const children = []
  const logs = []
  const context = {
    Buffer,
    Error,
    process,
    setTimeout,
    clearTimeout,
    requestTimeoutMs: 1000,
    threadListRequestTimeoutMs: 1000,
    createInterface,
    app: { getPath: () => '/fixture-profile' },
    console: { error: (...args) => logs.push(args) },
    getAppServerCommand: () => ({ command: 'fixture', args: [] }),
    getHostCommand: async () => ({ file: 'fixture', args: [], env: {} }),
    getCodexExecutableError,
    isCodexExecutableUnavailable,
    supportsLocalHostTools,
    registerBrowserUseSession() {},
    removeBrowserUseSession() {},
    removeBrowserUseSessions() {},
    registerCodexBrowserTools: () => ({ close() {} }),
    registerCodexDesktopTools: () => ({ close() {} }),
    CodexDynamicTools: class {
      specs = []
      bindings = new Map()
      readOnly = new Map()
      bind(id, specs) {
        this.bindings.set(id, specs)
      }
      setReadOnly(id, value) {
        this.readOnly.set(id, value)
      }
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
      child.requests = []
      child.failure = children.length === 0 && failInitialize ? brokenPipe() : null
      child.stdin = new Writable({
        write(chunk, _encoding, callback) {
          if (child.failure) {
            setImmediate(() => callback(child.failure))
            return
          }
          const message = JSON.parse(chunk.toString())
          child.requests.push(message)
          if (message.id && (child.autoReply || message.method === 'initialize'))
            queueMicrotask(() => {
              child.stdout.write(
                `${JSON.stringify({
                  id: message.id,
                  result: message.method === 'initialize' ? initializeResult : {}
                })}\n`
              )
            })
          callback()
        }
      })
      children.push(child)
      return child
    }
  }
  context.connectCodexRuntime = async () => {
    const child = context.spawn()
    child.detaches = 0
    child.detach = () => {
      child.detaches++
      queueMicrotask(() => child.emit('close', 0))
    }
    return child
  }
  const client = vm.runInNewContext(code, context)
  t.after(() => {
    client.dispose()
    for (const child of children) {
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
  })
  return { client, children, logs, context }
}

test('embedded browser tools reach local Codex sources independently of host desktop tools', (t) => {
  const { context } = fixture(t)
  const Client = context.Client
  for (const container of [
    null,
    { kind: 'host' },
    ...['distrobox', 'toolbox', 'docker', 'podman', 'ssh'].map((tool) => ({
      kind: 'container',
      tool,
      name: 'fixture'
    }))
  ]) {
    const client = new Client(container)
    const localBrowser =
      !container || container.kind === 'host' || ['distrobox', 'toolbox'].includes(container.tool)
    assert.equal(Boolean(client.browserTools), localBrowser, JSON.stringify(container))
    assert.equal(Boolean(client.desktopTools), localBrowser)
    client.dispose()
  }
})

test('browser declarations are sent on interactive start/resume and excluded from restricted queries', async (t) => {
  const { client, children } = fixture(t)
  const specs = [
    { type: 'namespace', name: 'sele_browser', tools: [{ type: 'function', name: 'tabs_context' }] }
  ]
  client.dynamicTools.specs = specs
  for (const method of ['thread/start', 'thread/resume']) {
    for (const restricted of [{}, { ephemeral: true }, { sandbox: 'read-only' }]) {
      await client.request(method, { threadId: 'fixture', ...restricted })
      const request = children[0].requests.at(-1)
      assert.deepEqual(
        request.params.dynamicTools,
        Object.keys(restricted).length ? undefined : specs
      )
    }
  }
})

test('background recovery initializes a retained runtime without submitting a turn', async (t) => {
  const { client, children, context } = fixture(t, {
    initializeResult: { seleRuntime: { threads: [{ thread: { id: 'running' } }] } }
  })
  client.persistent = true
  const connect = context.connectCodexRuntime
  const commands = []
  context.connectCodexRuntime = (...args) => {
    commands.push(args[2])
    return connect(...args)
  }
  const restored = []
  client.onNotification((notification) => {
    if (notification.method === 'sele/runtime/restored')
      restored.push(...notification.params.threadIds)
  })
  const recovery = client.recoverRuntime()
  assert.equal(client.recoverRuntime(), recovery)
  await recovery
  assert.deepEqual(commands, [null], 'recovery may only attach to an existing worker')
  assert.deepEqual(restored, ['running'])
  await client.request('model/list')
  assert.equal(children.length, 1, 'the foreground reuses the recovered connection')
  assert.deepEqual(
    children[0].requests.filter((request) => request.id).map((request) => request.method),
    ['initialize', 'model/list']
  )
})

for (const code of ['ENOENT', 'ECONNREFUSED']) {
  test(`missing retained runtime (${code}) does not launch until a foreground request`, async (t) => {
    const { client, children, context } = fixture(t)
    client.persistent = true
    const connect = context.connectCodexRuntime
    const commands = []
    context.connectCodexRuntime = async (...args) => {
      commands.push(args[2])
      if (args[2] === null) throw Object.assign(new Error('No retained worker'), { code })
      return connect(...args)
    }
    const recovery = client.recoverRuntime()
    // A user request arriving during recovery must still be able to start a fresh worker.
    const foreground = client.request('model/list')
    await recovery
    await foreground
    assert.equal(commands[0], null)
    assert.notEqual(commands[1], null)
    assert.equal(children.length, 1)
  })
}

test('background recovery preserves real connection failures', async (t) => {
  const { client, children, context } = fixture(t)
  client.persistent = true
  context.connectCodexRuntime = async () => {
    throw new Error('Process runtime rejected the connection.')
  }
  await assert.rejects(client.recoverRuntime(), /rejected the connection/)
  assert.equal(children.length, 0)
})

test('shutdown during background recovery detaches the late connection', async (t) => {
  const { client, children, context } = fixture(t)
  client.persistent = true
  const connect = context.connectCodexRuntime
  let finish
  const gate = new Promise((resolve) => {
    finish = resolve
  })
  context.connectCodexRuntime = async (...args) => {
    await gate
    return connect(...args)
  }
  const recovery = client.recoverRuntime()
  await tick()
  client.dispose({ preserveRuntime: true })
  finish()
  await recovery
  assert.equal(children[0].detaches, 1)
  assert.equal(children[0].kills, 0)
  assert.equal(client.connectionIdentity, null)
  assert.equal(client.startPromise, null)
})

test('expected terminal probes reject quietly while other RPC failures remain logged', async (t) => {
  const { client, children, logs } = fixture(t)
  await client.request('model/list')
  const child = children[0]
  child.autoReply = false
  const isExpectedError = (error) => /\bthread not (?:found|loaded)\b/i.test(error.message)
  for (const [method, message, options, logged] of [
    ['thread/backgroundTerminals/list', 'thread not found: old-chat', { isExpectedError }, false],
    ['thread/backgroundTerminals/list', 'permission denied', { isExpectedError }, true],
    ['thread/read', 'thread not found: old-chat', undefined, true]
  ]) {
    logs.length = 0
    const result = client.request(method, { threadId: 'old-chat' }, options)
    const rejected = assert.rejects(result, { message, code: -32600 })
    await tick()
    const id = child.requests.at(-1).id
    child.stdout.write(`${JSON.stringify({ id, error: { code: -32600, message } })}\n`)
    await rejected
    assert.equal(logs.length, logged ? 1 : 0)
    if (logged) assert.equal(logs[0][1], method)
  }
})

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

test('app shutdown detaches persistent workers while an explicit reset still stops them', async (t) => {
  const { client, children } = fixture(t)
  client.persistent = true
  await client.request('model/list')
  client.dispose({ preserveRuntime: true })
  await tick()
  assert.equal(children[0].detaches, 1)
  assert.equal(children[0].kills, 0)
  await client.request('model/list')
  client.dispose()
  assert.equal(children[1].kills, 1)
})

test('reattachment restores ownership and tool permissions before publishing recovery', async (t) => {
  const { client } = fixture(t, {
    initializeResult: {
      seleRuntime: {
        threads: [
          {
            thread: { id: 'running', cwd: '/fixture' },
            dynamicTools: [{ type: 'function', name: 'fixture' }],
            readOnly: true
          }
        ]
      }
    }
  })
  client.persistent = true
  const recovered = []
  client.onNotification((notification) => {
    if (notification.method !== 'sele/runtime/restored') return
    assert.equal(client.ownsThread('running'), true)
    assert.equal(client.dynamicTools.readOnly.get('running'), true)
    assert.equal(client.dynamicTools.bindings.get('running')[0].name, 'fixture')
    recovered.push(notification.params.threadIds)
  })
  await client.request('model/list')
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0][0], 'running')
})

test('a lost persistent connection reconnects without stopping the worker and reloads its chats', async (t) => {
  const { client, children } = fixture(t)
  client.persistent = true
  await client.request('model/list')
  client.ownedThreadIds.add('running')
  client.reconnectDelay = 1
  const recovered = []
  client.onNotification((notification) => recovered.push(notification))
  children[0].emit('error', brokenPipe())
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(children[0].kills, 0)
  assert.equal(children[0].detaches, 1)
  assert.equal(children.length, 2)
  assert.equal(recovered[0].method, 'sele/runtime/restored')
  assert.equal(recovered[0].params.threadIds[0], 'running')
})

test('shutdown cancels a scheduled reconnect', async (t) => {
  const { client, children } = fixture(t)
  client.persistent = true
  await client.request('model/list')
  client.reconnectDelay = 5
  children[0].emit('error', brokenPipe())
  client.dispose({ preserveRuntime: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(children.length, 1)
})

const captureTimers = (context) => {
  const timers = new Map()
  context.setTimeout = (callback, delay) => {
    const timer = { unref() {} }
    timers.set(timer, { callback, delay })
    return timer
  }
  context.clearTimeout = (timer) => timers.delete(timer)
  return {
    timers,
    async fire(delay) {
      assert.equal(timers.size, 1, 'there must be exactly one reconnect timer')
      const [timer, scheduled] = timers.entries().next().value
      assert.equal(scheduled.delay, delay)
      timers.delete(timer)
      scheduled.callback()
      await tick()
      await tick() // Drain asynchronous stdin errors from the newly attached process.
    }
  }
}

test('failed initial startup does not launch a background retry loop', async (t) => {
  const { client, children, context } = fixture(t, { failInitialize: true })
  const { timers } = captureTimers(context)
  client.persistent = true
  await assert.rejects(client.request('model/list'), { code: 'EPIPE' })
  await tick()
  assert.equal(children.length, 1)
  assert.equal(timers.size, 0)
  assert.equal(client.reconnectTimer, null)
  await client.request('model/list')
  assert.equal(children.length, 2, 'a foreground request can retry after startup fails')
})

test('failed reconnects back off once per attempt and reset after recovery', async (t) => {
  const { client, children, context } = fixture(t)
  const { timers, fire } = captureTimers(context)
  client.persistent = true
  await client.request('model/list')
  const connect = context.connectCodexRuntime
  context.connectCodexRuntime = async (...args) => {
    const child = await connect(...args)
    child.failure = brokenPipe()
    return child
  }
  children[0].emit('error', brokenPipe())
  for (const delay of [250, 500, 1000, 2000, 4000, 8000, 10000]) await fire(delay)
  context.connectCodexRuntime = connect
  await fire(10000)
  assert.equal(timers.size, 0)
  assert.equal(client.reconnectDelay, 250)
  assert.equal(client.connectionIdentity, children.at(-1))
})

for (const failure of [
  new Error('sele-codex-view: line 74: codex: command not found'),
  Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }),
  Object.assign(new Error('spawn codex EACCES'), { code: 'EACCES' })
]) {
  test(`an unavailable executable stops background recovery: ${failure.message}`, async (t) => {
    const { client, children, context, logs } = fixture(t)
    const { timers, fire } = captureTimers(context)
    client.persistent = true
    await client.request('model/list')
    const connect = context.connectCodexRuntime
    context.connectCodexRuntime = async (...args) => {
      const child = await connect(...args)
      if (failure.code) child.failure = failure
      else {
        child.stdin.destroy()
        child.stdin = new Writable({
          write(_chunk, _encoding, callback) {
            setImmediate(() => {
              child.stderr.write(failure.message)
              child.emit('close', 127)
            })
            callback()
          }
        })
      }
      return child
    }
    children[0].emit('error', brokenPipe())
    await fire(250)
    assert.equal(timers.size, 0)
    assert.equal(client.reconnectTimer, null)
    assert.equal(children.length, 2)
    assert.match(logs.at(-1)[1].message, /SELE_CODEX_PATH/)
    context.connectCodexRuntime = connect
    await client.request('model/list')
    assert.equal(children.length, 3, 'foreground requests can retry after the CLI is repaired')
  })
}

test('reports the negotiated CLI version for optional prediction capabilities', async (t) => {
  const { client } = fixture(t, { initializeResult: { userAgent: 'codex_cli_rs/0.166.0 (Linux)' } })
  await client.request('model/list')
  assert.equal(client.serverVersion, '0.166.0')
})

test('canceling a thread sample sends its actual wire request ID to sample/cancel', async (t) => {
  const { client, children } = fixture(t)
  await client.request('model/list')
  const child = children[0]
  child.autoReply = false
  const abort = new AbortController()
  const pending = client.request(
    'thread/sample',
    { threadId: 'parent', expectedTurnId: 'source' },
    { signal: abort.signal }
  )
  const rejected = assert.rejects(pending, /canceled/)
  await tick()
  const sample = child.requests.at(-1)
  child.autoReply = true
  abort.abort()
  await rejected
  await tick()
  assert.equal(child.requests.at(-1).method, 'thread/sample/cancel')
  assert.equal(child.requests.at(-1).params.requestId, sample.id)
  assert.equal(client.pendingRequests.size, 0)
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
})

test('temporary prediction cleanup cannot restart a disposed app-server', async (t) => {
  const { client, children } = fixture(t)
  await client.request('model/list')
  client.dispose()
  await assert.rejects(
    client.request('thread/unsubscribe', { threadId: 'temporary' }, { requireConnection: true }),
    /connection is closed/
  )
  assert.equal(children.length, 1)
})

test('reattachment ignores ephemeral prediction forks reported by older runtime workers', async (t) => {
  const { client } = fixture(t, {
    initializeResult: {
      seleRuntime: {
        threads: [
          { thread: { id: 'user-chat', cwd: '/fixture', ephemeral: false } },
          { thread: { id: 'prediction-fork', cwd: '/fixture', ephemeral: true } }
        ]
      }
    }
  })
  const restored = []
  client.onNotification((notification) => {
    if (notification.method === 'sele/runtime/restored')
      restored.push(...notification.params.threadIds)
  })
  await client.request('model/list')
  assert.deepEqual(restored, ['user-chat'])
  assert.equal(client.ownedThreadIds.has('prediction-fork'), false)
})
