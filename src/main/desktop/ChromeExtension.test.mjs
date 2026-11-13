import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { WebSocket as NodeWebSocket } from 'ws'
import { ChromeAutomation } from './ChromeAutomation.ts'

test('extension popup stays compact and reconnects without asking for pairing again', async () => {
  const elements = new Map(
    ['status', 'error', 'settings', 'pairing', 'disconnect', 'endpoint'].map((id) => [id, {}])
  )
  let state = { connected: true, paired: true, error: '' }
  let poll
  vm.runInNewContext(
    readFileSync(
      new URL('../../../resources/sele-chrome-extension/popup.js', import.meta.url),
      'utf8'
    ),
    {
      chrome: { runtime: { sendMessage: async () => state } },
      document: { getElementById: (id) => elements.get(id) },
      setInterval: (fn) => {
        poll = fn
      }
    }
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(elements.get('settings').open, false)
  assert.equal(elements.get('pairing').hidden, true)
  assert.match(elements.get('status').textContent, /Connected/)
  state = { connected: false, paired: true, error: '' }
  await poll()
  assert.match(elements.get('status').textContent, /Reconnecting automatically/)
  assert.equal(elements.get('pairing').hidden, true)
  state = { connected: false, paired: false, error: '' }
  await elements.get('disconnect').onclick()
  assert.equal(elements.get('settings').open, true)
  assert.equal(elements.get('pairing').hidden, false)
  assert.equal(elements.get('disconnect').hidden, true)
})

async function fixture(overrides = {}) {
  const listeners = {}
  const commands = []
  const local = overrides.local ?? {}
  const session = overrides.session ?? {}
  const browserTabs = overrides.browserTabs ?? []
  const area = (data) => ({
    get: async (key) => ({ [key]: data[key] }),
    set: async (value) => Object.assign(data, structuredClone(value)),
    remove: async (key) => {
      delete data[key]
    },
    setAccessLevel: async () => {}
  })
  const chrome = {
    storage: { local: area(local), session: area(session) },
    alarms: {
      get: async () => undefined,
      create: async () => {},
      clear: async () => {},
      onAlarm: {
        addListener: (fn) => {
          listeners.alarm = fn
        }
      }
    },
    debugger: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (...args) => {
        commands.push(args)
        return { result: 'fixture' }
      },
      onEvent: {
        addListener: (fn) => {
          listeners.event = fn
        }
      },
      onDetach: {
        addListener: (fn) => {
          listeners.detach = fn
        }
      }
    },
    tabs: {
      get: async (id) => ({ id, url: 'https://example.com' }),
      query: async () => browserTabs,
      onRemoved: { addListener: () => {} }
    },
    downloads: {
      onCreated: {
        addListener: (fn) => {
          listeners.created = fn
        }
      },
      onChanged: {
        addListener: (fn) => {
          listeners.changed = fn
        }
      }
    },
    runtime: {
      onStartup: {
        addListener: (fn) => {
          listeners.startup = fn
        }
      },
      onInstalled: { addListener: () => {} },
      onMessage: {
        addListener: (fn) => {
          listeners.message = fn
        }
      }
    }
  }
  const code = readFileSync(
    new URL('../../../resources/sele-chrome-extension/background.js', import.meta.url),
    'utf8'
  )
  const context = {
    chrome,
    URL,
    WebSocket: { OPEN: 1 },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    crypto: { randomUUID },
    ...overrides
  }
  vm.runInNewContext(
    `${code}\nglobalThis.fixture = {handle,shared,attached,downloads,allowedDownloads,connect,disconnect,ready,stopWorker:()=>{if(heartbeat)clearInterval(heartbeat);if(reconnectTimer!==null)clearTimeout(reconnectTimer);const previous=socket;socket=null;previous?.close()}};`,
    context
  )
  await context.fixture.ready
  return { ...context.fixture, listeners, commands, chrome, local, session, browserTabs }
}

test('paired browsers discover existing and newly opened websites without manual sharing', async (t) => {
  const transport = automaticSocket()
  const h = await fixture({
    ...transport,
    local: { selePairingV1: 'ws://127.0.0.1:12345/extension?token=fixture' },
    browserTabs: [
      { id: 10, url: 'https://www.linkedin.com/developers/apps', active: false },
      { id: 11, url: 'chrome://extensions' },
      { id: 12, url: 'opera://extensions' }
    ]
  })
  t.after(() => h.stopWorker())
  assert.deepEqual(
    Array.from(await h.handle('getTabs', {}), (tab) => tab.id),
    [10]
  )
  await h.handle('claimTab', { tabId: 10, owner: 'codex-a' })
  h.browserTabs.push({ id: 13, url: 'https://developers.facebook.com/apps', active: false })
  assert.deepEqual(
    Array.from(await h.handle('getTabs', {}), (tab) => tab.id),
    [10, 13]
  )
  await assert.rejects(
    h.handle('claimTab', { tabId: 10, owner: 'claude-b' }),
    /another conversation/
  )

  // A fresh browser session rediscovers actual tabs, never old numeric ownership.
  const restarted = await fixture({
    ...automaticSocket(),
    local: h.local,
    session: {},
    browserTabs: h.browserTabs
  })
  t.after(() => restarted.stopWorker())
  const tabs = await restarted.handle('getTabs', {})
  assert.deepEqual(
    Array.from(tabs, (tab) => tab.id),
    [10, 13]
  )
  assert.equal(tabs[0].owner, undefined)
})

test('canceling browser control stays revoked during automatic discovery and worker restart', async (t) => {
  const h = await fixture({
    ...automaticSocket(),
    local: { selePairingV1: 'ws://127.0.0.1:12345/extension?token=fixture' },
    browserTabs: [{ id: 10, url: 'https://example.com' }]
  })
  t.after(() => h.stopWorker())
  await h.handle('getTabs', {})
  await h.handle('attach', { tabId: 10 })
  h.listeners.detach({ tabId: 10 }, 'canceled_by_user')
  assert.equal((await h.handle('getTabs', {})).length, 0)
  const resumed = await fixture({
    ...automaticSocket(),
    local: h.local,
    session: h.session,
    browserTabs: h.browserTabs
  })
  t.after(() => resumed.stopWorker())
  assert.equal((await resumed.handle('getTabs', {})).length, 0)
})

test('Chrome extension creates a background tab when foreground is omitted', async () => {
  const h = await fixture()
  const created = []
  h.chrome.tabs.create = async (options) => {
    created.push(options)
    return { id: 99, url: options.url, active: options.active }
  }
  await h.handle('createTab', { owner: 'codex-owner' })
  assert.equal(created[0].active, false)
  assert.equal(h.shared.has(99), true)
  assert.equal((await h.handle('getTabs', {}))[0].owner, 'codex-owner')
})

test('a new background tab remains accessible before its blank URL commits', async () => {
  const h = await fixture()
  h.chrome.tabs.create = async () => ({ id: 99, pendingUrl: 'about:blank', active: false })
  h.chrome.tabs.get = async () => ({ id: 99, pendingUrl: 'about:blank', active: false })
  const created = await h.handle('createTab', { owner: 'codex-owner' })
  const listed = await h.handle('getTabs', {})
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, created.id)
  assert.equal(listed[0].url, 'about:blank')
  assert.equal(h.shared.has(99), true)
  await h.handle('attach', { tabId: created.id })

  for (const tab of [{ id: 99 }, { id: 99, pendingUrl: 'chrome://settings' }]) {
    h.chrome.tabs.get = async () => tab
    await assert.rejects(h.handle('attach', { tabId: 99 }), /cannot be automated/)
  }
})

test('Chrome extension enforces tab availability and forwards flattened CDP sessions', async () => {
  const h = await fixture()
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, method: 'Runtime.evaluate' }),
    /not available/
  )
  h.shared.add(3)
  await h.handle('attach', { tabId: 3 })
  h.listeners.event({ tabId: 3 }, 'Target.attachedToTarget', {
    sessionId: 'child',
    targetInfo: { type: 'iframe', targetId: 'iframe' }
  })
  await h.handle('executeCdp', {
    tabId: 3,
    sessionId: 'child',
    method: 'Runtime.evaluate',
    params: { expression: '1+1' }
  })
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, method: 'Target.createTarget' }),
    /Unsupported CDP/
  )
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, sessionId: 'foreign', method: 'Runtime.evaluate' }),
    /outside this shared tab/
  )
  assert.deepEqual(JSON.parse(JSON.stringify(h.commands[0])), [
    { tabId: 3, sessionId: 'child' },
    'Runtime.evaluate',
    { expression: '1+1' }
  ])
  await h.handle('detach', { tabId: 3 })
  h.listeners.detach({ tabId: 3 }, 'canceled_by_user')
  assert.equal(h.shared.has(3), true, 'late intentional detach must not revoke a new lease')
  await h.handle('attach', { tabId: 3 })
  h.listeners.detach({ tabId: 3 }, 'canceled_by_user')
  assert.equal(h.shared.has(3), false)
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, method: 'Page.navigate' }),
    /not available/
  )
})

test('Chrome download grants expire and are consumed once', async () => {
  const h = await fixture()
  h.shared.add(3)
  await h.handle('allowDownload', { tabId: 3, url: 'https://example.com/file' })
  h.listeners.created({ id: 1, url: 'https://example.com/file', filename: 'file', totalBytes: 5 })
  h.listeners.created({ id: 2, url: 'https://example.com/file', filename: 'file', totalBytes: 5 })
  assert.equal(h.downloads.get(3).length, 1)
  h.listeners.changed({ id: 1, state: { current: 'complete' } })
  assert.equal(h.downloads.get(3)[0].status, 'complete')
  h.allowedDownloads.set('https://example.com/expired', { tabId: 3, expires: 0 })
  h.listeners.created({ id: 3, url: 'https://example.com/expired' })
  assert.equal(h.downloads.get(3).length, 1)
})

test('disconnect cancels a late debugger attachment instead of restoring access', async () => {
  const h = await fixture()
  h.shared.add(3)
  let finish
  h.chrome.debugger.attach = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const pending = h.handle('executeCdp', { tabId: 3, method: 'Runtime.evaluate' })
  await new Promise((resolve) => setImmediate(resolve))
  await h.disconnect()
  finish()
  await assert.rejects(pending, /revoked/)
  assert.equal(h.attached.size, 0)
  assert.equal(h.commands.length, 0)
})

test('a transient connection loss reconnects without losing shared tabs; explicit disconnect revokes them', async () => {
  const sockets = []
  const timers = new Map()
  let nextTimer = 0
  class Socket {
    static OPEN = 1
    readyState = 1
    constructor(endpoint) {
      this.endpoint = endpoint
      sockets.push(this)
      queueMicrotask(() => this.onopen?.())
    }
    send() {}
    close() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  const h = await fixture({
    WebSocket: Socket,
    setTimeout: (callback) => {
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id) => timers.delete(id)
  })
  await h.connect('ws://127.0.0.1:12345/extension?token=fixture')
  h.shared.add(99)
  await h.handle('attach', { tabId: 99 })
  sockets[0].close()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(h.shared.has(99), true, 'a network interruption must not revoke tab sharing')
  assert.equal(h.attached.size, 0)
  assert.equal(timers.size, 1)
  const retry = timers.values().next().value
  timers.clear()
  retry()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(sockets.length, 2)
  assert.equal(sockets[1].endpoint, sockets[0].endpoint)
  assert.equal((await h.handle('getTabs', {}))[0].id, 99)
  sockets[1].close()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(timers.size, 1)
  const canceledRetry = timers.values().next().value
  await h.disconnect()
  assert.equal(h.shared.size, 0)
  assert.equal(timers.size, 0, 'an explicit disconnect must not retry')
  canceledRetry()
  assert.equal(sockets.length, 2)
})

function automaticSocket() {
  const sockets = []
  class Socket {
    static OPEN = 1
    readyState = 1
    constructor(endpoint) {
      this.endpoint = endpoint
      sockets.push(this)
      queueMicrotask(() => this.onopen?.())
    }
    send() {}
    close() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  return {
    WebSocket: Socket,
    sockets,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {}
  }
}

test('an immediate host request is handled even before the open promise resumes', async (t) => {
  const transport = automaticSocket()
  const replies = []
  class EagerSocket {
    static OPEN = 1
    readyState = 1
    constructor() {
      queueMicrotask(() => {
        this.onopen?.()
        this.onmessage?.({ data: JSON.stringify({ id: 1, method: 'getTabs', params: {} }) })
      })
    }
    send(value) {
      replies.push(JSON.parse(value))
    }
    close() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  const h = await fixture({
    ...transport,
    WebSocket: EagerSocket,
    local: { selePairingV1: 'ws://127.0.0.1:12345/extension?token=fixture' }
  })
  t.after(() => h.stopWorker())
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    replies.find((reply) => reply.id === 1),
    { id: 1, result: [] }
  )
})

test('worker restart restores pairing and owned tabs; Chrome restart restores only pairing', async () => {
  const transport = automaticSocket()
  const first = await fixture(transport)
  await first.connect('ws://127.0.0.1:12345/extension?token=fixture')
  first.chrome.tabs.create = async () => ({ id: 99, url: 'about:blank', active: false })
  await first.handle('createTab', { owner: 'codex-a' })
  const address = transport.sockets[0].endpoint
  const resumedTransport = automaticSocket()
  const resumed = await fixture({ ...resumedTransport, local: first.local, session: first.session })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(resumedTransport.sockets[0].endpoint, address)
  assert.equal((await resumed.handle('getTabs', {}))[0].owner, 'codex-a')
  await assert.rejects(
    resumed.handle('claimTab', { tabId: 99, owner: 'claude-b' }),
    /another conversation/
  )
  const restartedTransport = automaticSocket()
  const restarted = await fixture({ ...restartedTransport, local: first.local, session: {} })
  await new Promise((resolve) => setImmediate(resolve))
  assert.notEqual(
    restartedTransport.sockets[0].endpoint,
    address,
    'fresh Chrome has a fresh ownership epoch'
  )
  assert.equal(new URL(restartedTransport.sockets[0].endpoint).searchParams.get('token'), 'fixture')
  assert.equal((await restarted.handle('getTabs', {})).length, 0)
  await restarted.disconnect()
  const disconnectedTransport = automaticSocket()
  await fixture({ ...disconnectedTransport, local: restarted.local, session: restarted.session })
  assert.equal(
    disconnectedTransport.sockets.length,
    0,
    'Disconnect persists across worker/browser restart'
  )
})

test('an alarm retries a saved connection when Sele starts after Chrome', async () => {
  const transport = automaticSocket()
  const h = await fixture({
    ...transport,
    local: { selePairingV1: 'ws://127.0.0.1:12345/extension?token=fixture' }
  })
  await new Promise((resolve) => setImmediate(resolve))
  transport.sockets[0].close()
  await new Promise((resolve) => setImmediate(resolve))
  h.listeners.alarm({ name: 'sele-reconnect' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(transport.sockets.length, 2)
  assert.equal(transport.sockets[1].endpoint, transport.sockets[0].endpoint)
  await h.disconnect()
})

test('ownership storage failure blocks subsequent automation rather than losing isolation', async () => {
  const h = await fixture()
  h.chrome.tabs.create = async () => ({ id: 99, url: 'about:blank', active: false })
  h.chrome.storage.session.set = async () => {
    throw new Error('storage unavailable')
  }
  await assert.rejects(h.handle('createTab', { owner: 'codex-a' }), /storage unavailable/)
  await assert.rejects(h.handle('getTabs', {}), /storage unavailable/)
  await assert.rejects(
    fixture({ local: { selePairingV1: 'https://remote.example' } }),
    /pairing address/
  )
})

test('Disconnect revokes live control before delayed or failed durable removal', async () => {
  const h = await fixture()
  h.shared.add(3)
  let release
  h.chrome.storage.local.remove = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const disconnecting = h.disconnect()
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(
    h.handle('executeCdp', { tabId: 3, method: 'Input.insertText', params: { text: 'forbidden' } }),
    /disconnected|not available/
  )
  assert.equal(h.commands.length, 0)
  release()
  await disconnecting
  h.chrome.storage.local.remove = async () => {
    throw new Error('storage removal failed')
  }
  await assert.rejects(h.disconnect(), /storage removal failed/)
  await assert.rejects(h.handle('createTab', { owner: 'other' }), /storage removal failed/)
})

test('actual WebSocket transport recovers after Sele restarts and after a fresh Chrome session', async (t) => {
  let value = null
  const store = {
    load: async () => value,
    save: async (next) => {
      value = next
    },
    clear: async () => {
      value = null
    }
  }
  const first = new ChromeAutomation(store)
  const restored = new ChromeAutomation(store)
  const coldHost = new ChromeAutomation(store)
  const workers = []
  t.after(async () => {
    for (const worker of workers) worker.stopWorker()
    await first.close()
    await restored.close()
    await coldHost.close()
  })
  class ExtensionSocket extends NodeWebSocket {
    constructor(url) {
      super(url, { origin: `chrome-extension://${'a'.repeat(32)}` })
    }
  }
  const until = async (predicate) => {
    const deadline = Date.now() + 5000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Transport did not reconnect')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  await first.pair()
  const local = { selePairingV1: first.status.pairingUrl }
  const browserTabs = [{ id: 42, url: 'https://example.com/existing', active: false }]
  const h = await fixture({ WebSocket: ExtensionSocket, local, browserTabs })
  workers.push(h)
  await until(() => first.status.connected)
  h.chrome.tabs.create = async () => ({ id: 99, url: 'about:blank', active: false })
  const scope = (sessionId) => ({ providerId: 'codex', sessionId, cwd: '', containerKey: 'host' })
  const owner = JSON.stringify(['codex', 'owner', 'host'])
  await h.handle('createTab', { owner })
  assert.equal((await first.createClient(scope('owner')).listTabs())[0].id, 99)
  assert.deepEqual(
    (await first.createClient(scope('foreign')).listTabs()).map((tab) => tab.id),
    [42]
  )
  await first.createClient(scope('foreign')).attach(42)
  assert.deepEqual(
    (await first.createClient(scope('owner')).listTabs()).map((tab) => tab.id),
    [99]
  )
  await first.close()
  await restored.restore()
  await until(() => restored.status.connected)
  assert.equal((await restored.createClient(scope('owner')).listTabs())[0].id, 99)
  assert.deepEqual(
    (await restored.createClient(scope('foreign')).listTabs()).map((tab) => tab.id),
    [42]
  )
  h.stopWorker()
  await until(() => !restored.status.connected)
  await restored.close()
  // New browser session starts while Sele is absent; local pairing survives, session grants do not.
  const coldWorker = await fixture({ WebSocket: ExtensionSocket, local, session: {}, browserTabs })
  workers.push(coldWorker)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await coldHost.restore()
  await until(() => coldHost.status.connected)
  const rediscovered = await coldHost.createClient(scope('owner')).listTabs()
  assert.deepEqual(
    rediscovered.map((tab) => tab.id),
    [42]
  )
  await coldHost.createClient(scope('owner')).attach(42)
  assert.deepEqual(await coldHost.createClient(scope('foreign')).listTabs(), [])
})

test('navigation and temporary tab lookup failures never discard conversation ownership', async (t) => {
  const h = await fixture({
    ...automaticSocket(),
    local: { selePairingV1: 'ws://127.0.0.1:12345/extension?token=fixture' },
    browserTabs: [{ id: 91, url: 'https://example.com/start' }]
  })
  t.after(() => h.stopWorker())
  await h.handle('getTabs', {})
  await h.handle('claimTab', { tabId: 91, owner: 'original-chat' })
  h.chrome.tabs.get = async () => ({ id: 91, pendingUrl: 'https://example.com/next' })
  const pending = await h.handle('getTabs', {})
  assert.equal(pending[0]?.owner, 'original-chat')
  assert.equal(pending[0]?.url, 'https://example.com/next')
  h.chrome.tabs.get = async () => {
    throw new Error('Temporary browser lookup failure')
  }
  await assert.rejects(h.handle('getTabs', {}), /Temporary browser lookup failure/)
  h.chrome.tabs.get = async () => ({ id: 91, url: 'chrome://extensions' })
  assert.equal((await h.handle('getTabs', {})).length, 0)
  h.chrome.tabs.get = async () => ({ id: 91, url: 'https://example.com/next' })
  assert.equal((await h.handle('getTabs', {}))[0].owner, 'original-chat')
  await assert.rejects(
    h.handle('claimTab', { tabId: 91, owner: 'other-chat' }),
    /another conversation/
  )
})

test('a closed tab left in restored session state cannot break discovery of other tabs', async (t) => {
  const h = await fixture({
    ...automaticSocket(),
    local: { selePairingV1: 'ws://127.0.0.1:12345/extension?token=fixture' },
    browserTabs: [{ id: 92, url: 'https://example.com/live' }]
  })
  t.after(() => h.stopWorker())
  h.shared.add(91)
  h.chrome.tabs.get = async (id) => {
    if (id === 91) throw new Error('No tab with id: 91.')
    return { id, url: 'https://example.com/live' }
  }
  const tabs = await h.handle('getTabs', {})
  assert.deepEqual(
    Array.from(tabs, (tab) => tab.id),
    [92]
  )
  assert.equal(h.shared.has(91), false)
})
