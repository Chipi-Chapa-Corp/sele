import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const compiled = buildSync({
  entryPoints: ['src/renderer/src/mobileDiscovery.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['./secureLanSocket', './components/MobileConnectionScreen']
}).outputFiles[0].text

const computer = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Desktop',
  origin: 'https://192.168.1.1:4589',
  origins: ['https://192.168.1.1:4589', 'https://192.168.1.2:4589', 'https://192.168.1.3:4589']
}

const fixture = ({ cannotInspect, cannotOpen, approved = true } = {}) => {
  const inspected = []
  const opened = []
  const requests = []
  const secureNetwork = {
    inspectComputerCertificate: async (origin) => {
      inspected.push(origin)
      if (origin === cannotInspect) throw new Error('Cannot reach address')
      return 'a'.repeat(64)
    },
    createLanSocket: (url) => {
      opened.push(url)
      const socket = {
        close() {},
        send(packet) {
          requests.push(JSON.parse(packet))
          socket.onmessage({ data: JSON.stringify({ type: 'pairing', approved }) })
        }
      }
      queueMicrotask(() => {
        if (new URL(url).host === cannotOpen) socket.onclose()
        else socket.onopen()
      })
      return socket
    }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (id) => (id === './secureLanSocket' ? secureNetwork : require(id)),
    module,
    module.exports
  )
  return { ...module.exports, inspected, opened, requests }
}

test('first pairing tries another address after certificate inspection or WebSocket failure', async () => {
  const f = fixture({ cannotInspect: computer.origin, cannotOpen: '192.168.1.2:4589' })
  const codes = []
  const connection = await f.pairComputer(computer, new AbortController().signal, (code) =>
    codes.push(code)
  )
  assert.equal(connection.origin, computer.origins[2])
  assert.equal(connection.hostId, computer.id)
  assert.deepEqual(f.inspected, computer.origins)
  assert.equal(f.opened.length, 2)
  assert.equal(f.requests.length, 1)
  assert.match(codes[0], /^[A-F0-9]{4}( [A-F0-9]{4}){2}$/)
  assert.equal(codes.length, 1)
})

test('declining an approval request does not retry at another address', async () => {
  const f = fixture({ approved: false })
  await assert.rejects(f.pairComputer(computer, new AbortController().signal), /declined/)
  assert.deepEqual(f.inspected, [computer.origin])
  assert.equal(f.requests.length, 1)
})
