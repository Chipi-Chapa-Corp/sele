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
            : `export const providerApi = {
               onChatUpdated: listener => { globalThis.harness.publish = listener },
               getChat: (...args) => globalThis.harness.getChat(...args)
             };
             export const getChatUpdateSummary = () => {};
             export const getProviderChatCursorWindow = () => {};
             export const getProviderChatItemWindow = () => {};
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

test('a missing first acknowledgment holds completion and logs delivery state without content', () => {
  const h = setup()
  h.publish(1)
  h.publish(2, true)
  h.expire()
  assert.equal(h.sent.length, 1)
  const [level, source, diagnostic] = h.harness.logs[0]
  assert.equal(level, 'warn')
  assert.equal(source, 'chat-update-delivery')
  assert.equal(diagnostic.inFlightRevision, 1)
  assert.equal(diagnostic.pending[0].revision, 2)
  assert.equal(diagnostic.pending[0].turnCompleted, true)
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE/)
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
