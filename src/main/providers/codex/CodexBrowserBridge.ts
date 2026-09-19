import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { endianness } from 'node:os'
import { join } from 'node:path'
import type {
  BrowserAutomationService,
  BrowserAutomationClient
} from '../../browser/BrowserAutomation'
import { getBrowserUseSession, onBrowserUseSessionRemoved } from './CodexBrowserSessions'

// OpenAI's native transport: JSON-RPC in native-endian uint32 length frames.
const maxFrameBytes = 32 * 1024 * 1024
const littleEndian = endianness() === 'LE'
type Params = Record<string, unknown>
type RpcRequest = { id?: number | string; method: string; params?: Params }
function object(value: unknown): Params {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object')
  return value as Params
}
function positiveId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error('Invalid browser tab ID')
  return value
}

export async function startBrowserUseBridge(
  browser: BrowserAutomationService
): Promise<() => Promise<void>> {
  const sockets = new Set<Socket>()
  const connections = new Map<Socket, Map<string, BrowserAutomationClient>>()
  const send = (socket: Socket, value: unknown): void => {
    if (socket.destroyed) return
    const body = Buffer.from(JSON.stringify(value))
    if (body.length > maxFrameBytes) throw new Error('Browser response exceeds frame limit')
    const header = Buffer.alloc(4)
    if (littleEndian) header.writeUInt32LE(body.length)
    else header.writeUInt32BE(body.length)
    socket.write(Buffer.concat([header, body]))
  }
  const handle = async (request: RpcRequest, socket: Socket): Promise<unknown> => {
    const params = object(request.params ?? {})
    if (request.method === 'ping') return 'pong'
    const scope =
      typeof params.session_id === 'string' ? getBrowserUseSession(params.session_id) : undefined
    if (!scope) throw new Error('Browser session is not owned by Sele')
    const clients = connections.get(socket)
    if (!clients) throw new Error('Browser connection closed')
    let client = clients.get(scope.sessionId)
    if (!client) {
      client = browser.createClient(scope, (event) => {
        send(
          socket,
          event.type === 'detach'
            ? { jsonrpc: '2.0', method: 'onCDPDetach', params: { tabId: event.tabId } }
            : {
                jsonrpc: '2.0',
                method: 'onCDPEvent',
                params: {
                  source: {
                    tabId: event.tabId,
                    ...(event.sessionId ? { sessionId: event.sessionId } : {})
                  },
                  method: event.method,
                  params: event.params
                }
              }
        )
      })
      clients.set(scope.sessionId, client)
    }
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
        return client.listTabs()
      case 'createTab':
        return client.createTab()
      case 'attach':
        await client.attach(positiveId(params.tabId))
        return null
      case 'detach':
        client.detach(positiveId(params.tabId))
        return null
      case 'markTab':
        if (!(await client.listTabs()).some((tab) => tab.id === positiveId(params.tabId)))
          throw new Error('Tab is outside this browser workspace')
        if (params.status === 'handoff' || params.status === 'deliverable') {
          await client.activateTab(positiveId(params.tabId))
          await client.visibility(true)
        }
        return null
      case 'nameSession':
        return null
      case 'turnEnded':
        client.detachAll()
        return null
      case 'executeUnhandledCommand':
        if (params.type === 'browser_visibility_get' || params.type === 'browser_visibility_set')
          return client.visibility(typeof params.visible === 'boolean' ? params.visible : undefined)
        throw new Error(`Unsupported browser command: ${String(params.type)}`)
      case 'moveMouse':
        if (typeof params.x !== 'number' || typeof params.y !== 'number')
          throw new Error('Invalid mouse coordinates')
        await client.moveMouse(positiveId(params.tabId), params.x, params.y)
        return null
      case 'executeCdp': {
        const target = object(params.target)
        if (typeof params.method !== 'string') throw new Error('Invalid CDP method')
        return client.executeCdp(
          positiveId(target.tabId),
          params.method,
          object(params.commandParams ?? {}),
          typeof target.sessionId === 'string' ? target.sessionId : undefined
        )
      }
      default:
        throw new Error(`No handler registered for method: ${request.method}`)
    }
  }
  const server = createServer((socket) => {
    sockets.add(socket)
    connections.set(socket, new Map())
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
        } catch (error) {
          console.error('Unable to parse a Codex browser bridge request', error)
          socket.destroy()
          return
        }
        void handle(request, socket)
          .then(
            (result) => {
              if (request.id !== undefined) send(socket, { jsonrpc: '2.0', id: request.id, result })
            },
            (error: unknown) => {
              console.error(`Codex browser bridge request ${request.method} failed`, error)
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
          .catch((error: unknown) => {
            console.error('Unable to send a Codex browser bridge response', error)
            socket.destroy()
          })
      }
    })
    socket.on('error', (error) => {
      console.error('Codex browser bridge socket error', error)
      socket.destroy()
    })
    socket.on('close', () => {
      sockets.delete(socket)
      for (const client of connections.get(socket)?.values() ?? []) client.close()
      connections.delete(socket)
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
  const unsubscribe = onBrowserUseSessionRemoved((sessionId) => {
    for (const clients of connections.values()) {
      clients.get(sessionId)?.close()
      clients.delete(sessionId)
    }
  })
  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    unsubscribe()
    app.removeListener('will-quit', onQuit)
    for (const clients of connections.values())
      for (const client of clients.values()) client.close()
    connections.clear()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (process.platform !== 'win32')
      await unlink(path).catch((error: unknown) => {
        console.error('Unable to remove the Codex browser bridge socket', error)
      })
  }
  const onQuit = (): void => {
    void close()
  }
  app.once('will-quit', onQuit)
  return close
}
