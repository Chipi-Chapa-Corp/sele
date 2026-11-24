import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import test from 'node:test'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const compiled = buildSync({
  entryPoints: ['src/main/localAccessBroadcast.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
}).outputFiles[0].text

test('LAN broadcast answers on-link queries with the current HTTPS port and public identity', async () => {
  const identity = { id: 'aaaa0000-1234-1234-1234-123456789012', name: 'Mac', port: 4590 }
  const nonce = 'a'.repeat(32)
  const request = Buffer.from(`SELE-DISCOVER-1 ${nonce}`.padEnd(512))
  const replies = []
  let interfaceAddress = '192.168.1.20'
  class Socket extends EventEmitter {
    bind(port, address, callback) {
      assert.equal(port, 4589)
      assert.equal(address, '0.0.0.0')
      callback()
    }
    unref() {}
    close(callback) {
      callback()
    }
    send(reply, port, address) {
      replies.push({ reply, port, address })
    }
  }
  const socket = new Socket()
  const modules = {
    'node:dgram': { createSocket: () => socket },
    'node:os': {
      networkInterfaces: () => ({
        WiFi: [
          {
            address: interfaceAddress,
            family: 'IPv4',
            internal: false,
            cidr: `${interfaceAddress}/24`
          }
        ]
      })
    }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (id) => modules[id] ?? require(id),
    module,
    module.exports
  )
  const stop = module.exports.startLocalAccessBroadcast(identity)
  try {
    socket.emit('message', Buffer.from('unrelated broadcast'), {
      address: '192.168.1.10',
      port: 55555
    })
    socket.emit('message', request, { address: '192.168.2.10', port: 55555 })
    assert.deepEqual(replies, [])
    interfaceAddress = '192.168.2.20'
    socket.emit('message', request, { address: '192.168.2.10', port: 55555 })
    assert.equal(replies.length, 1)
    assert.equal(replies[0].address, '192.168.2.10')
    assert.equal(replies[0].port, 55555)
    assert.deepEqual(JSON.parse(replies[0].reply), { nonce, ...identity })
    assert.ok(replies[0].reply.length <= request.length)
  } finally {
    await stop()
  }
})
