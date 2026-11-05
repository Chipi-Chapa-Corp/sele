import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'
import { WebSocket, WebSocketServer } from 'ws'

const require = createRequire(import.meta.url)
const compiled = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
    export * from './src/main/localAccessServer'
    export * from './src/main/localAccessPairing'
    export * from './src/shared/localAccess'
    export * from './src/renderer/src/lanTransport'
    export * from './src/renderer/src/localPreferences'
  `
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['ws']
})
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  require,
  module,
  module.exports
)
const {
  startLocalAccessServer,
  createLocalAccessToken,
  encodeClientMessage,
  decodeClientMessage,
  LanTransport,
  createLocalPreferences,
  LocalAccessPairing
} = module.exports

const fixture = async (t, overrides = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-lan-'))
  await writeFile(
    join(directory, 'index.html'),
    '<html><head><meta http-equiv="Content-Security-Policy" content="default-src none"></head><body>Sele fixture</body></html>'
  )
  await writeFile(join(directory, 'app.js'), 'window.fixture = true')
  const token = createLocalAccessToken()
  const requests = []
  const messages = []
  const server = await startLocalAccessServer({
    port: 0,
    host: '127.0.0.1',
    token,
    assetsDirectory: directory,
    invoke: (client, channel, args) => {
      requests.push({ client, channel, args })
      if (channel === 'fail') throw new Error('Expected operation failure')
      if (channel === 'media') return { data: Uint8Array.from([0, 127, 128, 255]).buffer }
      return args
    },
    receive: (client, channel, args) => messages.push({ client, channel, args }),
    ...overrides
  })
  t.after(async () => {
    await server.stop()
    await rm(directory, { recursive: true, force: true })
  })
  const origin = `http://127.0.0.1:${server.port}`
  const connect = async (accessToken = token, clientOrigin = origin) => {
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/sele/ws`, { origin: clientOrigin })
    await once(ws, 'open')
    const result = once(ws, accessToken === token ? 'message' : 'close')
    ws.send(JSON.stringify({ type: 'hello', version: 1, token: accessToken }))
    await result
    return ws
  }
  return { directory, token, server, origin, connect, requests, messages }
}

test('serves the renderer with a LAN policy, rejects rebinding and traversal, and exposes no credentials', async (t) => {
  const f = await fixture(t)
  const response = await fetch(f.origin)
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /Sele fixture/)
  assert.doesNotMatch(html, /Content-Security-Policy|[a-f0-9]{64}/)
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(
    (await fetch(`${f.origin}/app.js`)).headers.get('content-type'),
    'text/javascript; charset=utf-8'
  )
  assert.equal((await fetch(`${f.origin}/local-access.json`)).status, 404)
  assert.equal((await fetch(`${f.origin}/%2e%2e%2fpackage.json`)).status, 404)
  const rebindingStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(f.origin, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(rebindingStatus, 403)
  assert.equal((await fetch(f.origin, { method: 'POST' })).status, 405)
})

test('rejects unauthorized sockets and cross-origin upgrades before dispatching operations', async (t) => {
  const f = await fixture(t)
  await f.connect('incorrect')
  assert.equal(f.requests.length, 0)
  const ws = new WebSocket(`${f.origin.replace('http:', 'ws:')}/sele/ws`, {
    origin: 'https://attacker.example'
  })
  const [error] = await once(ws, 'error')
  assert.match(error.message, /403/)
  const unauthenticated = new WebSocket(`${f.origin.replace('http:', 'ws:')}/sele/ws`, {
    origin: f.origin
  })
  await once(unauthenticated, 'open')
  const closed = once(unauthenticated, 'close')
  unauthenticated.send(JSON.stringify({ type: 'invoke', id: 1, channel: 'mutate', args: [] }))
  assert.equal((await closed)[0], 1008)
  assert.equal(f.requests.length, 0)
})

test('the packaged Android origin still requires the host access key', async (t) => {
  const f = await fixture(t)
  await f.connect('incorrect', 'http://sele.localhost')
  assert.equal(f.requests.length, 0)
  const ws = await f.connect(f.token, 'http://sele.localhost')
  const response = once(ws, 'message')
  ws.send(JSON.stringify({ type: 'invoke', id: 1, channel: 'android', args: ['paired'] }))
  assert.deepEqual(decodeClientMessage((await response)[0].toString()).result, ['paired'])
  ws.terminate()
})

test('development proxy limits filesystem access and forwards the Vite HMR connection', async (t) => {
  const paths = []
  const upstream = createServer((request, response) => {
    paths.push(request.url)
    response
      .writeHead(200, { 'Content-Type': 'text/javascript' })
      .end('export const fixture = true')
  })
  const hot = new WebSocketServer({ server: upstream })
  hot.on('connection', (socket) => socket.on('message', (data) => socket.send(`hot:${data}`)))
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    hot.clients.forEach((socket) => socket.terminate())
    hot.close()
    upstream.closeAllConnections()
    upstream.close()
  })
  const directory = await mkdtemp(join(tmpdir(), 'sele-lan-dev-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const f = await fixture(t, {
    devRendererUrl: `http://127.0.0.1:${upstream.address().port}`,
    devProjectDirectory: directory
  })
  assert.equal((await fetch(`${f.origin}/src/main.tsx`)).status, 200)
  assert.equal(
    (await fetch(`${f.origin}/@fs/${directory.replace(/^\//, '')}/src/shared/localAccess.ts`))
      .status,
    200
  )
  const allowedCount = paths.length
  assert.equal((await fetch(`${f.origin}/@fs/${directory}/local-access.json`)).status, 404)
  assert.equal((await fetch(`${f.origin}/@fs/etc/passwd`)).status, 404)
  assert.equal((await fetch(`${f.origin}/local-access.json`)).status, 404)
  assert.equal(paths.length, allowedCount, 'forbidden requests must not reach Vite')
  const ws = new WebSocket(`${f.origin.replace('http:', 'ws:')}/?token=fixture`, 'vite-hmr', {
    origin: f.origin
  })
  await once(ws, 'open')
  const reply = once(ws, 'message')
  ws.send('update')
  assert.equal((await reply)[0].toString(), 'hot:update')
  ws.terminate()
})

test('isolates simultaneous clients, carries binary media, and releases owners on disconnect', async (t) => {
  const f = await fixture(t)
  const first = await f.connect()
  const second = await f.connect()
  t.after(() => {
    first.terminate()
    second.terminate()
  })
  const invoke = async (ws, id, channel, args) => {
    const reply = once(ws, 'message')
    ws.send(encodeClientMessage({ type: 'invoke', id, channel, args }))
    return decodeClientMessage((await reply)[0].toString())
  }
  await invoke(first, 1, 'first', ['one'])
  await invoke(second, 1, 'second', ['two'])
  assert.notEqual(f.requests[0].client.id, f.requests[1].client.id)
  assert.ok(f.requests[0].client.id < 0)
  const event = once(first, 'message')
  f.requests[0].client.send('stream', { text: 'only first' })
  assert.deepEqual(decodeClientMessage((await event)[0].toString()), {
    type: 'event',
    channel: 'stream',
    args: [{ text: 'only first' }]
  })
  const media = await invoke(first, 2, 'media', [])
  assert.deepEqual([...new Uint8Array(media.result.data)], [0, 127, 128, 255])
  assert.equal((await invoke(first, 3, 'fail', [])).error, 'Expected operation failure')
  let released = false
  f.requests[0].client.once('destroyed', () => {
    released = true
  })
  const closed = once(first, 'close')
  first.close()
  await closed
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(released, true)
})

test('a slow phone receives large startup history and later replies without disconnecting', {
  timeout: 10000
}, async (t) => {
  const history = 'x'.repeat(14 * 1024 * 1024)
  const f = await fixture(t, {
    invoke: (_client, channel) => (channel === 'history' ? history : 'ready')
  })
  const ws = await f.connect()
  t.after(() => ws.terminate())
  const replies = new Map()
  const received = new Promise((resolve, reject) => {
    ws.on('message', (data) => {
      const result = decodeClientMessage(data.toString())
      replies.set(result.id, result.result)
      if (replies.size === 3) resolve()
    })
    ws.on('close', (code) => reject(new Error(`History transfer closed the connection: ${code}`)))
    ws.on('error', reject)
  })
  // Keep the peer from draining the server's socket while startup requests
  // resolve, reproducing the phone's history burst rather than a tiny fixture.
  ws.pause()
  for (const [id, channel] of [
    [1, 'history'],
    [2, 'models'],
    [3, 'accounts']
  ]) {
    ws.send(JSON.stringify({ type: 'invoke', id, channel, args: [] }))
  }
  const resume = setTimeout(() => ws.resume(), 100)
  t.after(() => clearTimeout(resume))
  await received
  assert.equal(replies.get(1).length, history.length)
  assert.equal(replies.get(2), 'ready')
  assert.equal(replies.get(3), 'ready')
  assert.equal(ws.readyState, WebSocket.OPEN)
})

test('browser transport rejects uncertain mutations and reconnects without replaying them', async (t) => {
  let client
  let mutations = 0
  const f = await fixture(t, {
    invoke: (owner) => {
      client = owner
      mutations++
      return new Promise(() => {})
    }
  })
  const previous = globalThis.WebSocket
  globalThis.WebSocket = class extends WebSocket {
    constructor(url) {
      super(url, { origin: new URL(url).origin.replace('ws:', 'http:') })
    }
  }
  t.after(() => {
    globalThis.WebSocket = previous
  })
  let reconnected
  const readyAgain = new Promise((resolve) => {
    reconnected = resolve
  })
  const transport = new LanTransport(
    `${f.origin.replace('http:', 'ws:')}/sele/ws`,
    f.token,
    () => {},
    reconnected
  )
  t.after(() => transport.close())
  await transport.connect()
  const request = transport.invoke('mutate', 'prompt')
  const rejected = assert.rejects(request, /may have completed/)
  while (!client) await new Promise((resolve) => setImmediate(resolve))
  // Server-side shutdown cannot retract work already dispatched to a provider.
  await f.server.stop()
  await rejected
  const replacement = await startLocalAccessServer({
    port: f.server.port,
    host: '127.0.0.1',
    token: f.token,
    assetsDirectory: f.directory,
    invoke: () => {
      mutations++
      return null
    },
    receive: () => {}
  })
  t.after(() => replacement.stop())
  await readyAgain
  assert.equal(mutations, 1)
})

test('phone preferences persist drafts without a host and report storage failures', async () => {
  const values = new Map()
  const storage = {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const preferences = createLocalPreferences(storage)
  assert.equal(preferences.setItem('sele:draft', 'offline draft').ok, true)
  assert.equal(
    (await createLocalPreferences(storage).initialize()).value['sele:draft'],
    'offline draft'
  )
  assert.equal(preferences.setItem('other-key', 'reject').ok, false)
  const failing = createLocalPreferences(storage)
  storage.setItem = () => {
    throw new Error('Storage is full')
  }
  assert.deepEqual(failing.setItem('sele:draft', 'new'), { ok: false, error: 'Storage is full' })
  assert.equal((await failing.flush()).ok, false)
  assert.equal(failing.commitPending().ok, false)
  assert.equal(createLocalPreferences(storage).getItem('sele:draft').value, 'offline draft')
})

test('device pairing requires approval, persists only hashed secrets, and supports revocation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-pairing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'devices.json')
  const pairing = new LocalAccessPairing(path)
  await pairing.load()
  const token = createLocalAccessToken()
  const request = { deviceId: '12345678-1234-1234-1234-123456789012', name: 'Test Android', token }
  const f = await fixture(t, {
    authorize: (value) => pairing.authorize(value),
    pair: (value, signal) => pairing.request(value, signal)
  })
  const socket = new WebSocket(`${f.origin.replace('http:', 'ws:')}/sele/ws`, {
    origin: 'http://sele.localhost'
  })
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'pair', version: 1, ...request }))
  while (!pairing.pending().length) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(pairing.authorize(token), false, 'requests do not grant access')
  assert.equal(pairing.pending()[0].name, 'Test Android')
  assert.equal(JSON.stringify(pairing.pending()).includes(token), false)
  const approved = once(socket, 'message')
  await pairing.decide(pairing.pending()[0].id, true)
  assert.equal(JSON.parse((await approved)[0]).approved, true)
  assert.equal(pairing.authorize(token), true)
  const { readFile, stat } = await import('node:fs/promises')
  assert.equal(
    (await readFile(path, 'utf8')).includes(token),
    false,
    'never persist bearer secrets on the host'
  )
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
  const restored = new LocalAccessPairing(path)
  await restored.load()
  assert.equal(restored.authorize(token), true)
  const client = new WebSocket(`${f.origin.replace('http:', 'ws:')}/sele/ws`, {
    origin: 'http://sele.localhost'
  })
  await once(client, 'open')
  let response = once(client, 'message')
  client.send(JSON.stringify({ type: 'hello', version: 1, token }))
  assert.equal(JSON.parse((await response)[0]).type, 'ready')
  response = once(client, 'close')
  await pairing.revoke(request.deviceId)
  f.server.disconnectUnauthorized()
  assert.equal((await response)[0], 1008)
  assert.equal(pairing.authorize(token), false)
  assert.deepEqual(pairing.list(), [])
})

test('declined, canceled, invalid, and concurrent pairing requests cannot gain unintended access', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-pairing-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const pairing = new LocalAccessPairing(join(directory, 'devices.json'))
  const make = (n) => ({
    deviceId: `12345678-1234-1234-1234-12345678901${n}`,
    name: `Phone ${n}`,
    token: createLocalAccessToken()
  })
  const abort = new AbortController()
  const first = make(1)
  const pending = pairing.request(first, abort.signal)
  await assert.rejects(pairing.request(first, abort.signal), /already waiting/)
  await assert.rejects(
    pairing.request({ ...first, name: 'Invalid\nName' }, abort.signal),
    /Invalid/
  )
  abort.abort()
  assert.equal(await pending, false)
  assert.equal(pairing.authorize(first.token), false)
  assert.deepEqual(pairing.pending(), [])
  const second = make(2)
  const declined = pairing.request(second, new AbortController().signal)
  await pairing.decide(pairing.pending()[0].id, false)
  assert.equal(await declined, false)
  assert.equal(pairing.authorize(second.token), false)
  const third = make(3)
  const fourth = make(4)
  const requests = [third, fourth].map((value) =>
    pairing.request(value, new AbortController().signal)
  )
  await Promise.all(pairing.pending().map((value) => pairing.decide(value.id, true)))
  assert.deepEqual(await Promise.all(requests), [true, true])
  assert.equal(pairing.list().length, 2, 'simultaneous approvals preserve both devices')
  assert.equal(pairing.authorize(third.token), true)
  assert.equal(pairing.authorize(fourth.token), true)
})

test('duplicate approval decisions share one commit without revoking the approved credential', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-pairing-duplicate-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'devices.json')
  const pairing = new LocalAccessPairing(path)
  await pairing.load()
  t.after(() => pairing.cancel())
  const token = createLocalAccessToken()
  const response = pairing.request(
    { deviceId: '12345678-1234-1234-1234-123456789012', name: 'Phone', token },
    new AbortController().signal
  )
  const id = pairing.pending()[0].id
  await Promise.all([pairing.decide(id, true), pairing.decide(id, true)])
  assert.equal(await response, true)
  assert.equal(pairing.authorize(token), true)
  const restored = new LocalAccessPairing(path)
  await restored.load()
  assert.equal(restored.authorize(token), true)
  assert.equal(restored.list().length, 1)
})

test('approval rechecks capacity inside the serialized commit and permits retry after revocation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-pairing-capacity-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'devices.json')
  const devices = Array.from({ length: 19 }, (_, index) => ({
    id: `existing-${index}`,
    name: `Existing ${index}`,
    pairedAt: 1,
    tokenHash: 'b'.repeat(64)
  }))
  await writeFile(path, JSON.stringify(devices))
  const pairing = new LocalAccessPairing(path)
  await pairing.load()
  t.after(() => pairing.cancel())
  const tokens = [0, 1, 2].map(() => createLocalAccessToken())
  const responses = tokens.map((token, index) =>
    pairing.request(
      { deviceId: `12345678-1234-1234-1234-12345678901${index}`, name: `Phone ${index}`, token },
      new AbortController().signal
    )
  )
  const requests = pairing.pending()
  const decisions = await Promise.allSettled(
    requests.map((request) => pairing.decide(request.id, true))
  )
  assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(decisions.filter((result) => result.status === 'rejected').length, 2)
  assert.equal(pairing.list().length, 20)
  assert.equal(tokens.filter((token) => pairing.authorize(token)).length, 1)
  await pairing.revoke(devices[0].id)
  const retry = pairing.pending()[0]
  await pairing.decide(retry.id, true)
  assert.equal(pairing.list().length, 20)
  pairing.cancel()
  assert.equal((await Promise.all(responses)).filter(Boolean).length, 2)
  const restored = new LocalAccessPairing(path)
  await restored.load()
  assert.equal(restored.list().length, 20)
})

test('a canceled approval cannot revoke a later successful pairing for the same device', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sele-pairing-replaced-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const pairing = new LocalAccessPairing(join(directory, 'devices.json'))
  await pairing.load()
  t.after(() => pairing.cancel())
  let written
  const firstWritten = new Promise((resolve) => {
    written = resolve
  })
  let release
  const held = new Promise((resolve) => {
    release = resolve
  })
  const persist = pairing.persist.bind(pairing)
  let commits = 0
  pairing.persist = async (update) => {
    await persist(update)
    if (++commits === 1) {
      written()
      await held
    }
  }
  const deviceId = '12345678-1234-1234-1234-123456789012'
  const firstToken = createLocalAccessToken()
  const abort = new AbortController()
  const first = pairing.request({ deviceId, name: 'Phone', token: firstToken }, abort.signal)
  const deciding = pairing.decide(pairing.pending()[0].id, true)
  await firstWritten
  abort.abort()
  const secondToken = createLocalAccessToken()
  const second = pairing.request(
    { deviceId, name: 'Phone', token: secondToken },
    new AbortController().signal
  )
  await pairing.decide(pairing.pending()[0].id, true)
  release()
  await deciding
  assert.deepEqual(await Promise.all([first, second]), [false, true])
  assert.equal(pairing.authorize(firstToken), false)
  assert.equal(pairing.authorize(secondToken), true)
})
