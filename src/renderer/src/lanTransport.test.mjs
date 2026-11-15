import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
const compiled = await build({
  entryPoints: ['src/renderer/src/lanTransport.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports
)
const { LanTransport } = module.exports
class Socket {
  static OPEN = 1
  static sockets = []
  readyState = 0
  sent = []
  constructor(url) {
    this.url = url
    Socket.sockets.push(this)
  }
  send(value) {
    this.sent.push(JSON.parse(value))
  }
  close() {
    this.readyState = 3
  }
  ready(options = {}) {
    this.readyState = 1
    this.onopen?.()
    this.onmessage?.({ data: JSON.stringify({ type: 'ready', version: 1, ...options }) })
  }
  disconnect(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}
const setup = (t) => {
  const previous = globalThis.WebSocket
  globalThis.WebSocket = Socket
  Socket.sockets = []
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const reconnects = []
  const transport = new LanTransport(
    'ws://192.168.1.2:4589/sele/ws',
    'a'.repeat(64),
    () => {},
    () => reconnects.push(true)
  )
  t.after(() => {
    transport.close()
    globalThis.WebSocket = previous
    t.mock.timers.reset()
  })
  return { transport, reconnects }
}

test('a silent handshake times out and closes cleanly; saved devices keep retrying', async (t) => {
  const { transport } = setup(t)
  const connect = transport.connect()
  const failed = assert.rejects(connect, /Connection lost/)
  t.mock.timers.tick(4000)
  await failed
  assert.equal(Socket.sockets[0].readyState, 3)
  t.mock.timers.tick(500)
  assert.equal(Socket.sockets.length, 2)
  Socket.sockets[1].ready()
  assert.equal(transport.isReady, true)
})

test('discovery replaces an unreachable endpoint and stale socket callbacks cannot disconnect its replacement', async (t) => {
  const { transport } = setup(t)
  const initial = transport.connect()
  const failed = assert.rejects(initial, /Connection lost/)
  const stale = Socket.sockets[0].onclose
  transport.updateEndpoints(['ws://192.168.1.20:4589/sele/ws', 'ws://192.168.1.2:4589/sele/ws'])
  await failed
  assert.equal(Socket.sockets[1].url, 'ws://192.168.1.20:4589/sele/ws')
  Socket.sockets[1].ready()
  stale({ code: 1006 })
  assert.equal(transport.isReady, true)
  transport.updateEndpoints(['ws://192.168.1.21:4589/sele/ws'])
  assert.equal(
    transport.isReady,
    true,
    'a discovery change never interrupts an established connection'
  )
})

test('foreground heartbeat detects half-open sockets and reconnects without replaying a mutation', async (t) => {
  const { transport, reconnects } = setup(t)
  const initial = transport.connect()
  Socket.sockets[0].ready({ heartbeat: true })
  await initial
  const pending = transport.invoke('send-prompt', 'only once')
  const failed = assert.rejects(pending, /may have completed/)
  transport.resume()
  assert.equal(Socket.sockets[0].sent.at(-1).type, 'ping')
  t.mock.timers.tick(10000)
  await failed
  t.mock.timers.tick(500)
  Socket.sockets[1].ready({ heartbeat: true })
  assert.equal(reconnects.length, 1)
  assert.equal(Socket.sockets[1].sent.filter((packet) => packet.type === 'invoke').length, 0)
  assert.equal(
    Socket.sockets[0].sent[0].sessionId,
    Socket.sockets[1].sent[0].sessionId,
    'a document resumes the same host session'
  )
})

test('revoked access stops retries and rejects readiness waits', async (t) => {
  const { transport } = setup(t)
  const connect = transport.connect()
  const failed = assert.rejects(connect, /revoked/)
  Socket.sockets[0].disconnect(1008)
  await failed
  await assert.rejects(transport.waitUntilReady(), /revoked/)
  t.mock.timers.tick(30000)
  transport.resume()
  assert.equal(Socket.sockets.length, 1)
})
