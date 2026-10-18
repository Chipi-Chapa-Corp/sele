const chrome = globalThis.chrome
let socket = null
let generation = 0
let heartbeat = null
const shared = new Set()
const attached = new Set()
const allowedDownloads = new Map()
const downloads = new Map()
const childSessions = new Map()
let connectionError = ''
const send = (value) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}
const safeTab = async (id) => {
  if (!shared.has(id)) throw new Error('Share this tab using the Sele extension first.')
  const tab = await chrome.tabs.get(id)
  if (!shared.has(id)) throw new Error('Tab sharing was revoked.')
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
  generation++
  const previous = socket
  socket = null
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  shared.clear()
  for (const id of attached) await detach(id)
  allowedDownloads.clear()
  downloads.clear()
  previous?.close()
}
async function connect(endpoint) {
  const url = new URL(endpoint)
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/extension' ||
    !url.searchParams.get('token')
  )
    throw new Error('Paste the local pairing address from Sele Settings.')
  await disconnect()
  connectionError = ''
  const connection = new WebSocket(url.href)
  socket = connection
  await new Promise((resolve, reject) => {
    connection.onopen = resolve
    connection.onerror = () =>
      reject(new Error('Unable to connect to Sele. Generate a new pairing address and retry.'))
  })
  heartbeat = setInterval(() => send({ method: 'ping' }), 20000)
  connection.onclose = () => {
    if (socket === connection) void disconnect()
  }
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
async function handle(method, params) {
  const revision = generation
  if (method === 'getTabs') {
    const tabs = []
    for (const id of shared) {
      try {
        tabs.push(summary(await safeTab(id)))
      } catch {
        shared.delete(id)
      }
    }
    return tabs
  }
  if (method === 'createTab') {
    const tab = await chrome.tabs.create({
      url: 'about:blank',
      active: params.foreground !== false
    })
    if (generation !== revision) throw new Error('Chrome connection was revoked.')
    shared.add(tab.id)
    return summary(tab)
  }
  const id = params.tabId
  await safeTab(id)
  if (generation !== revision) throw new Error('Chrome connection was revoked.')
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
  if (reason === 'canceled_by_user') shared.delete(source.tabId)
  send({ event: { type: 'detach', tabId: source.tabId } })
})
chrome.tabs.onRemoved.addListener((id) => {
  if (shared.delete(id)) send({ event: { type: 'detach', tabId: id } })
  attached.delete(id)
  childSessions.delete(id)
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
    if (message.action === 'connect') await connect(message.endpoint)
    if (message.action === 'disconnect') await disconnect()
    if (message.action === 'share') {
      if (socket?.readyState !== WebSocket.OPEN)
        throw new Error('Connect to Sele before sharing a tab.')
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !/^https?:\/\//.test(tab.url ?? ''))
        throw new Error('Open a normal website tab first.')
      shared.add(tab.id)
    }
    if (message.action === 'unshare') {
      await detach(message.tabId)
      shared.delete(message.tabId)
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
    return { connected: socket?.readyState === WebSocket.OPEN, tabs, error: connectionError }
  })().then(
    (result) => respond(result),
    (error) => respond({ error: error instanceof Error ? error.message : String(error) })
  )
  return true
})
