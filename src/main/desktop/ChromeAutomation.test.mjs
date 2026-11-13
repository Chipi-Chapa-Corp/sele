import assert from 'node:assert/strict'
import test from 'node:test'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { ChromeAutomation } from './ChromeAutomation.ts'

const epochOne = '00000000-0000-4000-8000-000000000001'
const epochTwo = '00000000-0000-4000-8000-000000000002'
const extensionUrl = (service, epoch = epochOne) => `${service.status.pairingUrl}&epoch=${epoch}`

function pairingStore() {
  let value = null
  return {
    load: async () => value && { ...value },
    save: async (next) => {
      value = { ...next }
    },
    clear: async () => {
      value = null
    }
  }
}

test('saved pairing survives a Sele restart and explicit disconnect removes it', async (t) => {
  const store = pairingStore()
  const first = new ChromeAutomation(store)
  const restored = new ChromeAutomation(store)
  t.after(async () => {
    await first.close()
    await restored.close()
  })
  await first.pair()
  const address = first.status.pairingUrl
  assert.ok(await store.load(), 'pairing must be persisted before reporting success')
  await first.close()
  assert.ok(await store.load(), 'application shutdown must retain pairing')
  assert.equal(await restored.restore(), true)
  assert.equal(restored.status.pairingUrl, address, 'both port and token must remain unchanged')
  await restored.disconnect()
  assert.equal(await store.load(), null)
  assert.equal(await new ChromeAutomation(store).restore(), false)
})

test('saved-port conflicts and persistence failures fail clearly without replacing the binding', async (t) => {
  const store = pairingStore()
  const first = new ChromeAutomation(store)
  const second = new ChromeAutomation(store)
  t.after(async () => {
    await first.close()
    await second.close()
  })
  await first.pair()
  const saved = await store.load()
  assert.ok(saved)
  await assert.rejects(second.restore(), /EADDRINUSE|already in use/)
  assert.deepEqual(await store.load(), saved)
  assert.equal(second.status.pairingUrl, null)
  const failed = new ChromeAutomation({
    ...store,
    save: async () => {
      throw new Error('encrypted storage unavailable')
    }
  })
  t.after(() => failed.close())
  await assert.rejects(failed.pair(), /encrypted storage unavailable/)
  assert.equal(failed.status.pairingUrl, null)
})

test('an explicitly shared tab claim stays bound to its conversation after Sele restarts', async (t) => {
  const store = pairingStore()
  const first = new ChromeAutomation(store)
  const restored = new ChromeAutomation(store)
  t.after(async () => {
    await first.close()
    await restored.close()
  })
  const tab = { id: 70, title: 'Shared fixture', url: 'about:blank', active: false }
  const connect = async (service) => {
    const socket = new WebSocket(extensionUrl(service), {
      origin: `chrome-extension://${'a'.repeat(32)}`
    })
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw))
      if (request.method === 'claimTab') tab.owner = request.params.owner
      socket.send(
        JSON.stringify({ id: request.id, result: request.method === 'getTabs' ? [tab] : null })
      )
    })
    await once(socket, 'open')
  }
  const scope = (sessionId) => ({ providerId: 'codex', sessionId, cwd: '', containerKey: 'host' })
  await first.pair()
  await connect(first)
  await first.createClient(scope('owner')).attach(70)
  assert.equal(tab.owner, JSON.stringify(['codex', 'owner', 'host']))
  await first.close()
  await restored.restore()
  await connect(restored)
  assert.equal((await restored.createClient(scope('owner')).listTabs())[0].id, 70)
  assert.deepEqual(await restored.createClient(scope('foreign')).listTabs(), [])
})

test('Chrome chat ownership survives client replacement and keeps new tabs in the background', async (t) => {
  const service = new ChromeAutomation()
  t.after(() => service.disconnect())
  await service.pair()
  const shared = new Map()
  const requests = []
  let nextTab = 10
  const extension = new WebSocket(extensionUrl(service), {
    origin: `chrome-extension://${'a'.repeat(32)}`
  })
  extension.on('message', (raw) => {
    const request = JSON.parse(String(raw))
    requests.push(request)
    let result = null
    if (request.method === 'createTab') {
      result = {
        id: ++nextTab,
        title: '',
        url: 'about:blank',
        active: request.params.foreground,
        owner: request.params.owner
      }
      shared.set(result.id, result)
    } else if (request.method === 'getTabs') result = [...shared.values()]
    else if (request.method === 'closeTab') shared.delete(request.params.tabId)
    extension.send(JSON.stringify({ id: request.id, result }))
  })
  await once(extension, 'open')
  const scope = (providerId, sessionId) => ({
    providerId,
    sessionId,
    cwd: '',
    containerKey: 'host'
  })
  const first = service.createClient(scope('codex', 'one'))
  const foreignEvents = []
  const second = service.createClient(scope('codex', 'two'), (event) => foreignEvents.push(event))
  const third = service.createClient(scope('claude', 'one'), (event) => foreignEvents.push(event))
  const fourth = service.createClient(scope('claude', 'two'))
  const clients = [first, second, third, fourth]
  const tabs = await Promise.all(clients.map((client) => client.createTab()))
  assert.equal(new Set(tabs.map((tab) => tab.id)).size, 4)
  assert.ok(
    requests
      .filter((request) => request.method === 'createTab')
      .every((request) => request.params.foreground === false)
  )
  for (let index = 0; index < clients.length; index++) {
    assert.deepEqual(
      (await clients[index].listTabs()).map((tab) => tab.id),
      [tabs[index].id]
    )
    for (let foreign = 0; foreign < clients.length; foreign++) {
      if (foreign === index) continue
      await assert.rejects(
        clients[index].attach(tabs[foreign].id),
        /not been shared|another conversation/
      )
    }
  }
  first.detachAll()
  first.close()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(
    (await second.listTabs()).map((tab) => tab.id),
    [tabs[1].id]
  )
  const resumedEvents = []
  const resumed = service.createClient(scope('codex', 'one'), (event) => resumedEvents.push(event))
  assert.deepEqual(
    (await resumed.listTabs()).map((tab) => tab.id),
    [tabs[0].id]
  )
  await resumed.attach(tabs[0].id)
  extension.send(
    JSON.stringify({
      event: { type: 'message', tabId: tabs[0].id, method: 'Page.loadEventFired', params: {} }
    })
  )
  await resumed.listTabs()
  assert.equal(resumedEvents.length, 1)
  assert.equal(foreignEvents.length, 0, 'browser events stay inside the owning provider/chat')
  const detachCount = requests.filter((request) => request.method === 'detach').length
  first.detachAll()
  await resumed.listTabs()
  assert.equal(
    requests.filter((request) => request.method === 'detach').length,
    detachCount,
    'a revoked client cannot detach the resumed chat'
  )
  await resumed.closeTab(tabs[0].id)
  assert.equal(shared.has(tabs[0].id), false)
  assert.deepEqual(
    (await fourth.listTabs()).map((tab) => tab.id),
    [tabs[3].id]
  )
  resumed.close()
  for (let index = 1; index < clients.length; index++) {
    await clients[index].closeTab(tabs[index].id)
    clients[index].close()
  }
})

test('temporary extension reconnect preserves conversation ownership', async (t) => {
  const service = new ChromeAutomation()
  t.after(() => service.disconnect())
  await service.pair()
  const tabs = [{ id: 42, url: 'about:blank', title: '', active: false }]
  const connect = async () => {
    const socket = new WebSocket(extensionUrl(service), {
      origin: `chrome-extension://${'a'.repeat(32)}`
    })
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw))
      if (request.method === 'createTab') tabs[0].owner = request.params.owner
      if (request.method === 'closeTab') tabs.length = 0
      socket.send(
        JSON.stringify({
          id: request.id,
          result:
            request.method === 'createTab' ? tabs[0] : request.method === 'getTabs' ? tabs : null
        })
      )
    })
    await once(socket, 'open')
    return socket
  }
  const scope = (providerId, sessionId) => ({
    providerId,
    sessionId,
    cwd: '',
    containerKey: 'host'
  })
  const owner = service.createClient(scope('codex', 'owner'))
  const foreign = service.createClient(scope('claude', 'foreign'))
  const socket = await connect()
  await owner.createTab()
  socket.close()
  await once(socket, 'close')
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(owner.listTabs(), /Pair the Sele Chrome/)
  await connect()
  assert.deepEqual(
    (await owner.listTabs()).map((tab) => tab.id),
    [42]
  )
  assert.deepEqual(
    (await foreign.listTabs()).map((tab) => tab.id),
    []
  )
  await assert.rejects(foreign.attach(42), /not been shared|another conversation/)
  await owner.closeTab(42)
  owner.close()
  foreign.close()
})

for (const interruption of ['closed client', 'lost response']) {
  test(`tab allocation remains owned after ${interruption}`, async (t) => {
    const service = new ChromeAutomation()
    t.after(() => service.disconnect())
    await service.pair()
    const shared = []
    let finishCreation
    const connect = async () => {
      const socket = new WebSocket(extensionUrl(service), {
        origin: `chrome-extension://${'a'.repeat(32)}`
      })
      socket.on('message', (raw) => {
        const request = JSON.parse(String(raw))
        if (request.method === 'createTab') {
          shared.push({
            id: 99,
            title: '',
            url: 'about:blank',
            active: false,
            owner: request.params.owner
          })
          finishCreation = () => socket.send(JSON.stringify({ id: request.id, result: shared[0] }))
        } else {
          if (request.method === 'closeTab') shared.length = 0
          socket.send(
            JSON.stringify({ id: request.id, result: request.method === 'getTabs' ? shared : null })
          )
        }
      })
      await once(socket, 'open')
      return socket
    }
    const firstSocket = await connect()
    const scope = (providerId, sessionId) => ({
      providerId,
      sessionId,
      cwd: '',
      containerKey: 'host'
    })
    const creator = service.createClient(scope('codex', 'creator'))
    const foreign = service.createClient(scope('claude', 'foreign'))
    const allocation = creator.createTab()
    const rejected = assert.rejects(allocation, /revoked|disconnected/)
    while (!finishCreation) await new Promise((resolve) => setImmediate(resolve))
    if (interruption === 'closed client') {
      creator.close()
      finishCreation()
    } else {
      firstSocket.close()
      await once(firstSocket, 'close')
      await connect()
    }
    await rejected
    assert.deepEqual(await foreign.listTabs(), [])
    await assert.rejects(foreign.attach(99), /not been shared|another conversation/)
    const resumed = service.createClient(scope('codex', 'creator'))
    const visible = await resumed.listTabs()
    assert.equal(visible[0].id, 99)
    assert.equal(
      'owner' in visible[0],
      false,
      'transport ownership must not leak into tool summaries'
    )
    await resumed.closeTab(99)
    resumed.close()
    creator.close()
    foreign.close()
  })
}

test('a new extension sharing epoch cannot reuse old conversation ownership', async (t) => {
  const service = new ChromeAutomation()
  t.after(() => service.disconnect())
  await service.pair()
  const scope = (providerId, sessionId) => ({
    providerId,
    sessionId,
    cwd: '',
    containerKey: 'host'
  })
  const oldClient = service.createClient(scope('codex', 'old'))
  const newClient = service.createClient(scope('claude', 'new'))
  let tabOwner
  const connect = async (epoch) => {
    const socket = new WebSocket(extensionUrl(service, epoch), {
      origin: `chrome-extension://${'a'.repeat(32)}`
    })
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw))
      if (request.method === 'createTab') tabOwner = request.params.owner
      socket.send(
        JSON.stringify({
          id: request.id,
          result:
            request.method === 'createTab'
              ? { id: 77, url: 'about:blank', active: false, owner: tabOwner }
              : request.method === 'getTabs'
                ? [{ id: 77, url: 'about:blank', active: false, owner: tabOwner }]
                : null
        })
      )
    })
    await once(socket, 'open')
    return socket
  }
  const first = await connect(epochOne)
  await oldClient.createTab()
  first.close()
  await once(first, 'close')
  tabOwner = JSON.stringify(['claude', 'new', 'host'])
  await connect(epochTwo)
  assert.deepEqual(await oldClient.listTabs(), [])
  assert.equal((await newClient.listTabs())[0].id, 77)
  await assert.rejects(oldClient.attach(77), /not been shared|another conversation/)
  await newClient.closeTab(77)
  oldClient.close()
  newClient.close()
})

test('Chrome pairing authenticates the extension, limits tab ownership, and revokes on disconnect', async () => {
  const service = new ChromeAutomation()
  test.after(() => service.disconnect())
  await service.pair()
  const wrong = new WebSocket(extensionUrl(service).replace(/token=[^&]+/, 'token=wrong'), {
    origin: `chrome-extension://${'a'.repeat(32)}`
  })
  wrong.on('error', () => {})
  await new Promise((resolve) => wrong.once('close', resolve))
  assert.equal(service.status.connected, false)
  const extension = new WebSocket(extensionUrl(service), {
    origin: `chrome-extension://${'a'.repeat(32)}`
  })
  const sharedTab = { id: 1, title: 'Shared tab', url: 'https://example.com', active: true }
  extension.on('message', (data) => {
    const request = JSON.parse(String(data))
    if (request.method === 'claimTab') sharedTab.owner = request.params.owner
    extension.send(
      JSON.stringify({
        id: request.id,
        result: request.method === 'getTabs' ? [sharedTab] : {}
      })
    )
  })
  await once(extension, 'open')
  const first = service.createClient({
    providerId: 'codex',
    sessionId: 'one',
    cwd: '',
    containerKey: 'host'
  })
  assert.deepEqual(service.getConnectionInfo(), {
    browser: 'Chrome',
    connected: true,
    extensionId: 'a'.repeat(32)
  })
  const second = service.createClient({
    providerId: 'claude',
    sessionId: 'two',
    cwd: '',
    containerKey: 'host'
  })
  assert.equal((await first.listTabs()).length, 1)
  await first.attach(1)
  assert.equal((await second.listTabs()).length, 0)
  await assert.rejects(
    second.executeCdp(1, 'Runtime.evaluate', { expression: '1' }),
    /not been shared|another conversation/
  )
  await assert.rejects(
    first.executeCdp(999, 'Page.navigate', { url: 'https://example.com' }),
    /unavailable/
  )
  await service.disconnect()
  assert.deepEqual(service.getConnectionInfo(), {
    browser: 'Chrome',
    connected: false,
    extensionId: null
  })
  await assert.rejects(first.listTabs(), /Pair the Sele/)
  first.close()
  second.close()
})

test('Disconnect stops the live transport even if saved binding removal fails', async (t) => {
  const store = pairingStore()
  const service = new ChromeAutomation(store)
  t.after(() => service.close())
  await service.pair()
  store.clear = async () => {
    throw new Error('saved binding removal failed')
  }
  await assert.rejects(service.disconnect(), /saved binding removal failed/)
  assert.equal(service.status.pairingUrl, null)
  assert.equal(service.status.connected, false)
})

test('offline unshare and explicit reshare remove the old host owner', async (t) => {
  const service = new ChromeAutomation()
  t.after(() => service.close())
  await service.pair()
  const tab = { id: 80, title: '', url: 'about:blank', active: false }
  const connect = async () => {
    const socket = new WebSocket(extensionUrl(service), {
      origin: `chrome-extension://${'a'.repeat(32)}`
    })
    socket.on('message', (raw) => {
      const request = JSON.parse(String(raw))
      if (request.method === 'claimTab') {
        if (tab.owner && tab.owner !== request.params.owner) {
          socket.send(JSON.stringify({ id: request.id, error: 'belongs to another conversation' }))
          return
        }
        tab.owner = request.params.owner
      }
      socket.send(
        JSON.stringify({ id: request.id, result: request.method === 'getTabs' ? [tab] : null })
      )
    })
    await once(socket, 'open')
    return socket
  }
  const scope = (sessionId) => ({ providerId: 'codex', sessionId, cwd: '', containerKey: 'host' })
  const old = service.createClient(scope('old'))
  const fresh = service.createClient(scope('fresh'))
  const socket = await connect()
  await old.attach(tab.id)
  socket.close()
  await once(socket, 'close')
  delete tab.owner // User unshared offline and explicitly shared it again.
  await connect()
  assert.equal((await fresh.listTabs())[0].id, tab.id)
  await fresh.attach(tab.id)
  assert.deepEqual(await old.listTabs(), [])
})
