import { app, BrowserWindow, ipcMain, session, webContents, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { endianness } from 'node:os'
import { join } from 'node:path'
import {
  browserIpcChannels,
  isBrowserPageUrl,
  type BrowserAutomationRequest,
  type BrowserAutomationResponse,
  type BrowserAutomationScope,
  type BrowserAutomationTab
} from '../shared/browser'
import { getBrowserUseSession } from './browserUseSessions'

// Browser Use's native transport: JSON-RPC 2.0 in native-endian uint32 length frames.
// Keep this socket private to the OS user; only sessions started by Sele can use it.
const maxFrameBytes = 32 * 1024 * 1024
const littleEndian = endianness() === 'LE'
type Params = Record<string, unknown>
type RpcRequest = { id?: number | string; method: string; params?: Params }
type PendingUi = {
  renderer: WebContents
  request: BrowserAutomationRequest
  sent: boolean
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function object(value: unknown): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object')
  return value as Params
}

function positiveId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Invalid browser tab ID')
  }
  return value
}

export async function startBrowserUseBridge(): Promise<() => Promise<void>> {
  const pending = new Map<string, PendingUi>()
  const ready = new Set<number>()
  const sockets = new Set<Socket>()
  const attached = new Map<number, { connection: Socket; sessionId: string; cleanup: () => void }>()

  const send = (socket: Socket, value: unknown): void => {
    if (socket.destroyed) return
    const body = Buffer.from(JSON.stringify(value))
    if (body.length > maxFrameBytes) throw new Error('Browser response exceeds frame limit')
    const header = Buffer.alloc(4)
    if (littleEndian) header.writeUInt32LE(body.length)
    else header.writeUInt32BE(body.length)
    socket.write(Buffer.concat([header, body]))
  }

  const finishUi = (id: string, error?: Error, result?: unknown): void => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (error) entry.reject(error)
    else entry.resolve(result)
  }
  const sendUi = (entry: PendingUi): void => {
    if (entry.sent || entry.renderer.isDestroyed()) return
    entry.sent = true
    entry.renderer.send(browserIpcChannels.automationRequest, entry.request)
  }
  const onReady = (event: Electron.IpcMainEvent, value: unknown): void => {
    if (!BrowserWindow.fromWebContents(event.sender)) return
    if (value === true) {
      ready.add(event.sender.id)
      for (const entry of pending.values()) if (entry.renderer === event.sender) sendUi(entry)
    } else {
      ready.delete(event.sender.id)
      // React StrictMode briefly unregisters the newly mounted panel. Keep requests
      // queued until it is ready again; the existing deadline handles a real closure.
      for (const entry of pending.values()) {
        if (entry.renderer === event.sender) entry.sent = false
      }
    }
  }
  const onResponse = (event: Electron.IpcMainEvent, response: BrowserAutomationResponse): void => {
    if (!response || typeof response.id !== 'string') return
    const entry = pending.get(response.id)
    if (entry?.renderer !== event.sender) return
    finishUi(response.id, response.error ? new Error(response.error) : undefined, response.result)
  }
  const onVisibility = (event: Electron.IpcMainEvent, visible: unknown): void => {
    if (typeof visible !== 'boolean' || !BrowserWindow.fromWebContents(event.sender)) return
    event.sender.send(browserIpcChannels.automationVisibility, visible)
  }

  const ui = (
    scope: BrowserAutomationScope,
    command: Omit<BrowserAutomationRequest, 'id' | 'scope'>
  ): Promise<unknown> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) return Promise.reject(new Error('Sele has no open window'))
    const renderer = window.webContents
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const entry: PendingUi = {
        renderer,
        request: { ...command, scope, id },
        sent: false,
        resolve,
        reject,
        timer: setTimeout(() => finishUi(id, new Error('Sele browser did not respond')), 15000)
      }
      pending.set(id, entry)
      renderer.send(browserIpcChannels.automationOpen, id)
      if (ready.has(renderer.id)) sendUi(entry)
    })
  }

  const tabs = async (scope: BrowserAutomationScope): Promise<BrowserAutomationTab[]> =>
    (await ui(scope, { method: 'list' })) as BrowserAutomationTab[]

  const guestFor = async (scope: BrowserAutomationScope, id: number): Promise<WebContents> => {
    if (!(await tabs(scope)).some((tab) => tab.id === id))
      throw new Error('Tab is outside this browser workspace')
    const guest = webContents.fromId(id)
    if (
      !guest ||
      guest.isDestroyed() ||
      guest.getType() !== 'webview' ||
      guest.session !== appSession()
    )
      throw new Error('Tab is not a Sele browser page')
    return guest
  }

  const detach = (id: number, socket: Socket): void => {
    const state = attached.get(id)
    if (!state || state.connection !== socket) return
    attached.delete(id)
    state.cleanup()
    const guest = webContents.fromId(id)
    if (guest && !guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
  }

  const attach = async (
    scope: BrowserAutomationScope,
    id: number,
    socket: Socket
  ): Promise<WebContents> => {
    const guest = await guestFor(scope, id)
    const existing = attached.get(id)
    if (existing && (existing.connection !== socket || existing.sessionId !== scope.sessionId)) {
      throw new Error('Tab is controlled by another browser session')
    }
    if (existing) return guest
    if (guest.debugger.isAttached()) throw new Error('Tab debugger is already in use')
    guest.debugger.attach('1.3')
    const onMessage = (
      _: Electron.Event,
      method: string,
      params: Params,
      sessionId?: string
    ): void => {
      send(socket, {
        jsonrpc: '2.0',
        method: 'onCDPEvent',
        params: {
          source: { tabId: id, ...(sessionId ? { sessionId } : {}) },
          method,
          params
        }
      })
    }
    const onDetach = (): void => {
      attached.delete(id)
      guest.debugger.removeListener('message', onMessage)
      send(socket, { jsonrpc: '2.0', method: 'onCDPDetach', params: { tabId: id } })
    }
    guest.debugger.on('message', onMessage)
    guest.debugger.once('detach', onDetach)
    attached.set(id, {
      connection: socket,
      sessionId: scope.sessionId,
      cleanup: () => {
        guest.debugger.removeListener('message', onMessage)
        guest.debugger.removeListener('detach', onDetach)
      }
    })
    return guest
  }

  const handle = async (request: RpcRequest, socket: Socket): Promise<unknown> => {
    const params = object(request.params ?? {})
    if (request.method === 'ping') return 'pong'
    const scope =
      typeof params.session_id === 'string' ? getBrowserUseSession(params.session_id) : undefined
    if (!scope) throw new Error('Browser session is not owned by Sele')
    switch (request.method) {
      case 'getInfo':
        return {
          name: 'Sele',
          type: 'iab',
          metadata: {
            codexSessionId: scope.sessionId,
            codexAppBuildFlavor: process.env.BROWSER_USE_CODEX_APP_BUILD_FLAVOR ?? 'prod'
          },
          capabilities: {
            browser: [{ id: 'visibility', description: 'Show or hide Sele’s browser' }],
            tab: []
          }
        }
      case 'getTabs':
        return tabs(scope)
      case 'createTab':
        return ui(scope, { method: 'create' })
      case 'attach':
        await attach(scope, positiveId(params.tabId), socket)
        return null
      case 'detach':
        detach(positiveId(params.tabId), socket)
        return null
      case 'markTab':
        await guestFor(scope, positiveId(params.tabId))
        if (params.status === 'handoff' || params.status === 'deliverable') {
          await ui(scope, { method: 'activate', tabId: positiveId(params.tabId) })
          await ui(scope, { method: 'visibility', visible: true })
        }
        return null
      case 'nameSession':
        return null
      case 'turnEnded':
        for (const [id, entry] of attached) {
          if (entry.connection === socket && entry.sessionId === scope.sessionId) detach(id, socket)
        }
        return null
      case 'executeUnhandledCommand':
        if (params.type === 'browser_visibility_get' || params.type === 'browser_visibility_set') {
          return ui(scope, {
            method: 'visibility',
            ...(typeof params.visible === 'boolean' ? { visible: params.visible } : {})
          })
        }
        throw new Error(`Unsupported browser command: ${String(params.type)}`)
      case 'moveMouse': {
        const guest = await guestFor(scope, positiveId(params.tabId))
        if (typeof params.x !== 'number' || typeof params.y !== 'number')
          throw new Error('Invalid mouse coordinates')
        guest.sendInputEvent({
          type: 'mouseMove',
          x: Math.round(params.x),
          y: Math.round(params.y)
        })
        return null
      }
      case 'executeCdp': {
        const target = object(params.target)
        const id = positiveId(target.tabId)
        const guest = await attach(scope, id, socket)
        const method = params.method
        const command = object(params.commandParams ?? {})
        if (typeof method !== 'string') throw new Error('Invalid CDP method')
        // Never expose Electron's shell, other renderers, or browser-global CDP operations.
        if (method === 'Target.getTargets') {
          const info = await guest.debugger.sendCommand('Target.getTargetInfo')
          return { targetInfos: [{ ...info.targetInfo, tabId: id }] }
        }
        if (method === 'Target.closeTarget' || method === 'Page.close') {
          const info = await guest.debugger.sendCommand('Target.getTargetInfo')
          if (command.targetId !== undefined && command.targetId !== info.targetInfo.targetId)
            throw new Error('Target is outside this tab')
          detach(id, socket)
          await ui(scope, { method: 'close', tabId: id })
          return { success: true }
        }
        // Electron owns guest navigation; use its navigation controller rather than
        // letting browser-level CDP history operations affect the embedder.
        if (method === 'Page.reload') {
          if (command.ignoreCache === true) guest.reloadIgnoringCache()
          else guest.reload()
          return {}
        }
        if (method === 'Page.getNavigationHistory') {
          return {
            currentIndex: guest.navigationHistory.getActiveIndex(),
            entries: guest.navigationHistory.getAllEntries().map((entry, index) => ({
              id: index,
              url: entry.url,
              userTypedURL: entry.url,
              title: entry.title,
              transitionType: 'link'
            }))
          }
        }
        if (method === 'Page.navigateToHistoryEntry') {
          const index = command.entryId
          if (
            typeof index !== 'number' ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= guest.navigationHistory.length()
          )
            throw new Error('Invalid navigation entry')
          guest.navigationHistory.goToIndex(index)
          return {}
        }
        if (method === 'Page.bringToFront') {
          await ui(scope, { method: 'activate', tabId: id })
          return {}
        }
        if (
          method === 'Page.navigate' &&
          (typeof command.url !== 'string' ||
            (!isBrowserPageUrl(command.url) && command.url !== 'about:blank'))
        ) {
          throw new Error('Unsupported browser navigation URL')
        }
        const domains = new Set([
          'Accessibility',
          'DOM',
          'DOMSnapshot',
          'CSS',
          'Runtime',
          'Page',
          'Input',
          'Network',
          'Emulation',
          'Performance',
          'Log',
          'Overlay'
        ])
        const targetMethods = new Set([
          'Target.getTargetInfo',
          'Target.setAutoAttach',
          'Target.attachToTarget',
          'Target.detachFromTarget'
        ])
        if (!domains.has(method.split('.')[0]) && !targetMethods.has(method))
          throw new Error(`Unsupported CDP method: ${method}`)
        if (method === 'Target.getTargetInfo' && command.targetId) {
          const info = await guest.debugger.sendCommand('Target.getTargetInfo')
          if (command.targetId !== info.targetInfo.targetId)
            throw new Error('Target is outside this tab')
        }
        if (method === 'Target.attachToTarget')
          throw new Error('Use flattened child sessions for iframe targets')
        return guest.debugger.sendCommand(
          method,
          command,
          typeof target.sessionId === 'string' ? target.sessionId : undefined
        )
      }
      default:
        throw new Error(`No handler registered for method: ${request.method}`)
    }
  }

  const server = createServer((socket) => {
    sockets.add(socket)
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const length = littleEndian ? buffer.readUInt32LE() : buffer.readUInt32BE()
        if (length > maxFrameBytes) {
          socket.destroy()
          return
        }
        if (buffer.length < length + 4) return
        const body = buffer.subarray(4, length + 4)
        buffer = buffer.subarray(length + 4)
        let request: RpcRequest
        try {
          request = object(JSON.parse(body.toString())) as RpcRequest
          if (typeof request.method !== 'string') throw new Error('Invalid request')
        } catch {
          socket.destroy()
          return
        }
        void handle(request, socket)
          .then(
            (result) => {
              if (request.id !== undefined) send(socket, { jsonrpc: '2.0', id: request.id, result })
            },
            (error: unknown) => {
              if (request.id !== undefined)
                send(socket, {
                  jsonrpc: '2.0',
                  id: request.id,
                  error: {
                    code: -32000,
                    message: error instanceof Error ? error.message : String(error)
                  }
                })
            }
          )
          .catch(() => socket.destroy())
      }
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      sockets.delete(socket)
      for (const [id, entry] of attached) if (entry.connection === socket) detach(id, socket)
    })
  })

  let path: string
  if (process.platform === 'win32') path = `\\\\.\\pipe\\codex-browser-use-sele-${process.pid}`
  else {
    const directory = '/tmp/codex-browser-use'
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) {
      throw new Error('Browser-use socket directory is not owned by the current user')
    }
    path = join(directory, `sele-${process.pid}-${randomUUID()}.sock`)
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  if (process.platform !== 'win32') await chmod(path, 0o600)
  ipcMain.on(browserIpcChannels.automationReady, onReady)
  ipcMain.on(browserIpcChannels.automationResponse, onResponse)
  ipcMain.on(browserIpcChannels.automationVisibility, onVisibility)
  const close = async (): Promise<void> => {
    ipcMain.removeListener(browserIpcChannels.automationReady, onReady)
    ipcMain.removeListener(browserIpcChannels.automationResponse, onResponse)
    ipcMain.removeListener(browserIpcChannels.automationVisibility, onVisibility)
    for (const id of pending.keys()) finishUi(id, new Error('Browser bridge stopped'))
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (process.platform !== 'win32') await unlink(path).catch(() => {})
  }
  app.once('will-quit', () => {
    void close()
  })
  return close
}

const appSession = (): Electron.Session => session.fromPartition('persist:sele-browser')
