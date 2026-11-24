import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import test from 'node:test'
import { decode, encode } from 'dns-packet'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const compiled = buildSync({
  entryPoints: ['src/main/localAccessDiscovery.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['@homebridge/ciao', 'dns-packet']
}).outputFiles[0].text

test('nearby discovery reports failed multicast and recovers after access is granted', async (t) => {
  const name = 'Sele 12345678._sele._tcp.local'
  const port = 4589
  const address = '192.168.1.20'
  const interfaces = []
  const pending = new Set()
  let permission = false
  let stopped = 0
  class Socket extends EventEmitter {
    bind(port, address, ready) {
      this.address = address
      pending.add(this)
      queueMicrotask(ready)
    }
    setMulticastInterface() {}
    setMulticastLoopback() {}
    setMulticastTTL() {}
    send(query, port, address, reply) {
      if (!permission) {
        reply(new Error('EPERM'))
        return
      }
      reply(null)
      this.emit(
        'message',
        encode({
          type: 'response',
          id: decode(query).id,
          answers: [{ name, type: 'SRV', data: { port: 4589, target: 'sele-fixture.local' } }]
        }),
        { address: this.address, port: 5353 }
      )
    }
    close() {
      pending.delete(this)
    }
  }
  const modules = {
    'node:os': {
      networkInterfaces: () => ({
        'Wi-Fi': [{ address, family: 'IPv4', internal: false }],
        Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        'IPv6 only': [{ address: 'fe80::1', family: 'IPv6', internal: false }]
      })
    },
    'node:dgram': { createSocket: () => new Socket() },
    '@homebridge/ciao': {
      getResponder: (options) => {
        interfaces.push(options.interface)
        return {
          createService: () => ({ getFQDN: () => `${name}.`, advertise: async () => {} }),
          shutdown: async () => {
            stopped++
          }
        }
      }
    }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (id) => modules[id] ?? require(id),
    module,
    module.exports
  )
  const reports = []
  let resolved
  const verified = new Promise((resolve) => {
    resolved = resolve
  })
  const stop = module.exports.startLocalAccessDiscovery(
    { computerId: '12345678', computerName: 'Fixture', port },
    (error) => {
      reports.push(error)
      if (error) permission = true
      else resolved()
    }
  )
  t.after(stop)
  const deadline = setTimeout(() => resolved(), 10_000)
  try {
    await verified
    assert.match(reports[0], /Multicast discovery could not be verified/)
    assert.deepEqual(reports.slice(1), [null])
    assert.deepEqual(interfaces, [['Wi-Fi'], ['Wi-Fi']])
    assert.equal(stopped, 1)
    assert.equal(pending.size, 0)
  } finally {
    clearTimeout(deadline)
  }
})
