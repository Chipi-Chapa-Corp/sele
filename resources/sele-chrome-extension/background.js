const chrome = globalThis.chrome
let socket = null
let generation = 0
let heartbeat = null
let pairingEndpoint = null
let reconnectTimer = null
let sharingEpoch = crypto.randomUUID()
const shared = new Set()
const tabOwners = new Map()
const attached = new Set()
const allowedDownloads = new Map()
const downloads = new Map()
const childSessions = new Map()
let connectionError = ''
const PAIRING_KEY = 'selePairingV1'
const SESSION_KEY = 'seleSharingV1'
const RECONNECT_ALARM = 'sele-reconnect'
let storageError = null
let writes = Promise.resolve()
function validEndpoint(endpoint) {
  const url = new URL(endpoint)
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/extension' ||
    !url.port ||
    !url.searchParams.get('token') ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Paste the local pairing address from Sele Settings.')
  return url.href
}
function persistSession() {
  const value = { epoch: sharingEpoch, tabs: [...shared], owners: [...tabOwners] }
  const write = writes.then(() => chrome.storage.session.set({ [SESSION_KEY]: value }))
  writes = write.catch((error) => {
    storageError = error
    throw error
  })
  // Events may have no caller, but the failure remains latched and blocks automation.
  void writes.catch((error) => {
    connectionError = 'Unable to save Chrome tab ownership: ' + error.message
  })
  return write
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get(RECONNECT_ALARM)))
    await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 })
}
async function bootstrap() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  const local = await chrome.storage.local.get(PAIRING_KEY)
  const session = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY]
  if (session !== undefined) {
    if (
      !session ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session.epoch) ||
      !Array.isArray(session.tabs) ||
      !session.tabs.every((id) => Number.isInteger(id) && id > 0) ||
      new Set(session.tabs).size !== session.tabs.length ||
      !Array.isArray(session.owners) ||
      !session.owners.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          session.tabs.includes(entry[0]) &&
          typeof entry[1] === 'string' &&
          entry[1].length > 0 &&
          entry[1].length <= 2048
      )
    )
      throw new Error('Invalid saved Chrome sharing session. Reconnect the extension explicitly.')
    if (new Set(session.owners.map(([id]) => id)).size !== session.owners.length)
      throw new Error('Duplicate saved Chrome ownership. Reconnect the extension explicitly.')
    sharingEpoch = session.epoch
    for (const id of session.tabs) shared.add(id)
    for (const [id, owner] of session.owners) tabOwners.set(id, owner)
  } else await persistSession()
  if (local[PAIRING_KEY] !== undefined) {
    pairingEndpoint = validEndpoint(local[PAIRING_KEY])
    await ensureAlarm()
    void connect(pairingEndpoint, true).catch((error) => {
      connectionError = error.message
    })
  }
}
let ready = bootstrap().catch((error) => {
  storageError = error
  connectionError = 'Unable to restore Chrome connection: ' + error.message
  throw error
})
void ready.catch(() => {})
async function checkReady() {
  await ready
  await writes
  if (storageError) throw storageError
}
function wake() {
  void checkReady()
    .then(async () => {
      if (!pairingEndpoint) return
      await ensureAlarm()
      if (!socket) await connect(pairingEndpoint, true)
    })
    .catch((error) => {
      connectionError = error.message
    })
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) wake()
})
chrome.runtime.onStartup.addListener(wake)
chrome.runtime.onInstalled.addListener(wake)
const send = (value) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}
const safeTab = async (id) => {
  if (!shared.has(id)) throw new Error('Share this tab using the Sele extension first.')
  const tab = await chrome.tabs.get(id)
  if (!shared.has(id)) throw new Error('Tab sharing was revoked.')
  // Chrome can return a newly created blank tab before its URL has committed.
  // Accept only that explicit pending navigation; a missing URL alone is invalid.
  if (!tab.url && tab.pendingUrl === 'about:blank') return { ...tab, url: tab.pendingUrl }
  if (!/^https?:\/\//.test(tab.url ?? '') && tab.url !== 'about:blank')
    throw new Error('This browser page cannot be automated.')
  return tab
}
const summary = (tab) => ({
  id: tab.id,
  title: tab.title ?? '',
  url: tab.url ?? '',
  active: tab.active
})
const attach = async (id) => {
  const revision = generation
  await safeTab(id)
  if (!attached.has(id)) {
    await chrome.debugger.attach({ tabId: id }, '1.3')
    if (generation !== revision || !shared.has(id)) {
      await chrome.debugger.detach({ tabId: id }).catch(() => {})
      throw new Error('Tab sharing was revoked.')
    }
    attached.add(id)
  }
}
const detach = async (id) => {
  if (!attached.has(id)) return
  attached.delete(id)
  childSessions.delete(id)
  try {
    await chrome.debugger.detach({ tabId: id })
  } catch {
    /* Tab or debugger was already closed. */
  }
}
async function disconnect() {
  // Revoke live access synchronously, before any potentially slow storage call.
  generation++
  storageError = new Error('Chrome connection is being disconnected.')
  pairingEndpoint = null
  sharingEpoch = crypto.randomUUID()
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
  const previous = socket
  socket = null
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  shared.clear()
  tabOwners.clear()
  allowedDownloads.clear()
  downloads.clear()
  previous?.close()
  const detachments = [...attached].map((id) => detach(id))
  try {
    await writes.catch(() => {})
    // Keep automation blocked until all durable revocation has completed.
    storageError = new Error('Chrome connection is being disconnected.')
    await chrome.storage.local.remove(PAIRING_KEY)
    await chrome.alarms.clear(RECONNECT_ALARM)
    writes = Promise.resolve()
    await persistSession()
    storageError = null
  } catch (error) {
    storageError = error
    connectionError = 'Unable to remove saved Chrome connection: ' + error.message
    throw error
  } finally {
    await Promise.all(detachments)
  }
}
function retryConnection() {
  if (!pairingEndpoint || socket || reconnectTimer !== null) return
  const endpoint = pairingEndpoint
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (pairingEndpoint === endpoint && !socket)
      void connect(endpoint, true).catch((error) => {
        connectionError = error instanceof Error ? error.message : String(error)
      })
  }, 1000)
}
async function connect(endpoint, reconnect = false) {
  const url = new URL(validEndpoint(endpoint))
  if (!reconnect) {
    await disconnect()
    await chrome.storage.local.set({ [PAIRING_KEY]: url.href })
    await ensureAlarm()
  }
  pairingEndpoint = url.href
  connectionError = ''
  const connectionUrl = new URL(url.href)
  connectionUrl.searchParams.set('epoch', sharingEpoch)
  const connection = new WebSocket(connectionUrl.href)
  socket = connection
  connection.onclose = async () => {
    if (socket !== connection) return
    socket = null
    generation++
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    // Keep explicit sharing while retrying the same authenticated connection.
    // Drop old debugger attachments before that connection can resume actions.
    await Promise.all([...attached].map((id) => detach(id)))
    retryConnection()
  }
  await new Promise((resolve, reject) => {
    connection.onopen = resolve
    connection.onerror = () => {
      connectionError = 'Unable to connect to Sele. Waiting to reconnect.'
      reject(new Error('Sele is unavailable. The saved connection will retry automatically.'))
    }
  })
  if (socket !== connection) return
  connectionError = ''
  heartbeat = setInterval(() => send({ method: 'ping' }), 20000)
  connection.onerror = () => {
    connectionError = 'Connection failed.'
  }
  connection.onmessage = async (event) => {
    if (socket !== connection) return
    let request
    try {
      request = JSON.parse(event.data)
      if (request.method === 'pong') return
      const result = await handle(request.method, request.params ?? {})
      if (socket === connection) send({ id: request.id, result })
    } catch (error) {
      if (socket === connection)
        send({ id: request?.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
let operations = Promise.resolve()
function handle(method, params) {
  const operation = operations.then(async () => {
    await checkReady()
    return perform(method, params)
  })
  operations = operation.catch(() => {})
  return operation
}
async function perform(method, params) {
  const revision = generation
  if (method === 'getTabs') {
    const tabs = []
    for (const id of shared) {
      try {
        const tab = summary(await safeTab(id))
        if (tabOwners.has(id)) tab.owner = tabOwners.get(id)
        tabs.push(tab)
      } catch {
        shared.delete(id)
        tabOwners.delete(id)
      }
    }
    await persistSession()
    return tabs
  }
  if (method === 'createTab') {
    if (typeof params.owner !== 'string' || !params.owner || params.owner.length > 2048)
      throw new Error('A conversation owner is required to create a Chrome tab.')
    const tab = await chrome.tabs.create({
      url: 'about:blank',
      active: params.foreground === true
    })
    if (generation !== revision) throw new Error('Chrome connection was revoked.')
    // Bind the allocation before exposing it, even if its response is lost.
    tabOwners.set(tab.id, params.owner)
    shared.add(tab.id)
    await persistSession()
    if (generation !== revision) throw new Error('Chrome connection was revoked.')
    return { ...summary(tab), owner: params.owner }
  }
  const id = params.tabId
  await safeTab(id)
  if (generation !== revision) throw new Error('Chrome connection was revoked.')
  if (method === 'claimTab') {
    if (typeof params.owner !== 'string' || !params.owner || params.owner.length > 2048)
      throw new Error('A conversation owner is required to claim a Chrome tab.')
    if (tabOwners.has(id) && tabOwners.get(id) !== params.owner)
      throw new Error('Chrome tab belongs to another conversation.')
    tabOwners.set(id, params.owner)
    await persistSession()
    return null
  }
  if (method === 'attach') {
    await attach(id)
    return null
  }
  if (method === 'detach') {
    await detach(id)
    return null
  }
  if (method === 'activateTab') {
    await chrome.tabs.update(id, { active: true })
    return null
  }
  if (method === 'closeTab') {
    await chrome.tabs.remove(id)
    shared.delete(id)
    tabOwners.delete(id)
    await persistSession()
    return null
  }
  if (method === 'allowDownload') {
    allowedDownloads.set(params.url, { tabId: id, expires: Date.now() + 30000 })
    return null
  }
  if (method === 'getDownloads') return downloads.get(id) ?? []
  if (method === 'executeCdp') {
    await attach(id)
    if (generation !== revision) throw new Error('Chrome connection was revoked.')
    const domains = new Set([
      'Accessibility',
      'DOM',
      'DOMSnapshot',
      'CSS',
      'Runtime',
      'Page',
      'Input',
      'Network',
      'Fetch',
      'Emulation',
      'Performance',
      'Log',
      'Overlay'
    ])
    const targets = new Set([
      'Target.getTargetInfo',
      'Target.setAutoAttach',
      'Target.attachToTarget',
      'Target.detachFromTarget'
    ])
    if (!domains.has(params.method?.split('.')[0]) && !targets.has(params.method))
      throw new Error('Unsupported CDP method: ' + params.method)
    const command = params.params ?? {}
    const children = childSessions.get(id) ?? new Map()
    if (params.sessionId && !children.has(params.sessionId))
      throw new Error('Child session is outside this shared tab.')
    if (
      params.method === 'Page.navigate' &&
      !/^https?:\/\//.test(command.url ?? '') &&
      command.url !== 'about:blank'
    )
      throw new Error('Unsupported navigation URL.')
    if (params.method === 'Target.setAutoAttach') {
      if (command.flatten !== true) throw new Error('Use flattened iframe attachment.')
      command.filter = [{ type: 'iframe', exclude: false }]
    }
    if (
      params.method === 'Target.attachToTarget' &&
      (command.flatten !== true ||
        ![...children.values()].some((info) => info.targetId === command.targetId))
    )
      throw new Error('Target is outside this shared tab.')
    if (params.method === 'Target.detachFromTarget' && !children.has(command.sessionId))
      throw new Error('Child session is outside this shared tab.')
    if (params.method === 'Target.getTargetInfo' && command.targetId) {
      const info = params.sessionId
        ? { targetInfo: children.get(params.sessionId) }
        : await chrome.debugger.sendCommand({ tabId: id }, 'Target.getTargetInfo')
      if (command.targetId !== info.targetInfo?.targetId)
        throw new Error('Target is outside this shared tab.')
    }
    return (
      (await chrome.debugger.sendCommand(
        { tabId: id, ...(params.sessionId ? { sessionId: params.sessionId } : {}) },
        params.method,
        command
      )) ?? {}
    )
  }
  throw new Error('Unsupported Chrome operation.')
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (!shared.has(source.tabId) || !attached.has(source.tabId)) return
  const children = childSessions.get(source.tabId) ?? new Map()
  childSessions.set(source.tabId, children)
  if (method === 'Target.attachedToTarget') {
    if (params.targetInfo?.type !== 'iframe') {
      void chrome.debugger
        .sendCommand(source, 'Target.detachFromTarget', { sessionId: params.sessionId })
        .catch(() => {})
      return
    }
    children.set(params.sessionId, params.targetInfo)
  } else if (method === 'Target.detachedFromTarget') children.delete(params.sessionId)
  if (shared.has(source.tabId))
    send({
      event: {
        type: 'message',
        tabId: source.tabId,
        method,
        params,
        ...(source.sessionId ? { sessionId: source.sessionId } : {})
      }
    })
})
chrome.debugger.onDetach.addListener((source, reason) => {
  if (!attached.delete(source.tabId)) return
  childSessions.delete(source.tabId)
  if (reason === 'canceled_by_user') {
    shared.delete(source.tabId)
    tabOwners.delete(source.tabId)
    void persistSession().catch(() => {})
  }
  send({ event: { type: 'detach', tabId: source.tabId } })
})
chrome.tabs.onRemoved.addListener((id) => {
  if (shared.delete(id)) send({ event: { type: 'detach', tabId: id } })
  tabOwners.delete(id)
  attached.delete(id)
  childSessions.delete(id)
  void ready.then(() => persistSession()).catch(() => {})
})
chrome.downloads.onCreated.addListener((item) => {
  const permission = allowedDownloads.get(item.url)
  allowedDownloads.delete(item.url)
  if (!permission || permission.expires < Date.now() || !shared.has(permission.tabId)) return
  const id = permission.tabId
  const values = downloads.get(id) ?? []
  values.push({
    id: String(item.id),
    tabId: id,
    url: item.url,
    filename: item.filename,
    status: 'in_progress',
    receivedBytes: 0,
    totalBytes: item.totalBytes,
    path: null
  })
  downloads.set(id, values)
})
chrome.downloads.onChanged.addListener((delta) => {
  for (const [tabId, values] of downloads) {
    const item = values.find((value) => value.id === String(delta.id))
    if (!item) continue
    if (delta.state)
      item.status =
        delta.state.current === 'complete'
          ? 'complete'
          : delta.state.current === 'interrupted'
            ? 'canceled'
            : 'in_progress'
    if (delta.filename) {
      item.filename = delta.filename.current
      item.path = delta.filename.current
    }
    if (delta.bytesReceived) item.receivedBytes = delta.bytesReceived.current
    send({ event: { type: 'download', tabId, download: item } })
  }
})
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  ;(async () => {
    await ready.catch((error) => {
      if (!['connect', 'disconnect'].includes(message.action)) throw error
    })
    if (!['connect', 'disconnect'].includes(message.action)) await checkReady()
    if (message.action === 'connect') {
      ready = Promise.resolve()
      await connect(message.endpoint)
    }
    if (message.action === 'disconnect') {
      await disconnect()
      ready = Promise.resolve()
    }
    if (message.action === 'share') {
      if (socket?.readyState !== WebSocket.OPEN)
        throw new Error('Connect to Sele before sharing a tab.')
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !/^https?:\/\//.test(tab.url ?? ''))
        throw new Error('Open a normal website tab first.')
      shared.add(tab.id)
      await persistSession()
    }
    if (message.action === 'unshare') {
      await detach(message.tabId)
      shared.delete(message.tabId)
      tabOwners.delete(message.tabId)
      await persistSession()
      send({ event: { type: 'detach', tabId: message.tabId } })
    }
    const tabs = []
    for (const id of shared) {
      try {
        tabs.push(summary(await chrome.tabs.get(id)))
      } catch {
        shared.delete(id)
      }
    }
    await persistSession()
    return { connected: socket?.readyState === WebSocket.OPEN, tabs, error: connectionError }
  })().then(
    (result) => respond(result),
    (error) => respond({ error: error instanceof Error ? error.message : String(error) })
  )
  return true
})
