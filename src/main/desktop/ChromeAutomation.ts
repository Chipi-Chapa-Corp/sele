import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type {
  BrowserAutomationClient,
  BrowserAutomationService,
  BrowserCdpEvent,
  BrowserCdpParams,
  BrowserDownload
} from '../browser/BrowserAutomation'
import type { BrowserAutomationScope, BrowserAutomationTab } from '../../shared/browser'

/** User-paired extension transport. Only tabs explicitly shared in Chrome are visible. */
export class ChromeAutomation implements BrowserAutomationService {
  private http: Server | null = null
  private sockets: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private token = ''
  private pairingUrl: string | null = null
  private nextId = 0
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private detaching = new Set<number>()
  private owners = new Map<number, object>()
  private listeners = new Map<object, (event: BrowserCdpEvent) => void>()
  get status(): { connected: boolean; pairingUrl: string | null } {
    return { connected: this.socket?.readyState === WebSocket.OPEN, pairingUrl: this.pairingUrl }
  }

  async pair(): Promise<void> {
    await this.disconnect()
    this.token = randomBytes(32).toString('base64url')
    const server = createServer((_request, response) => response.writeHead(404).end())
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })
    this.http = server
    this.sockets = sockets
    server.on('upgrade', (request, socket, head) => {
      const supplied = Buffer.from(
        new URL(request.url ?? '/', 'http://localhost').searchParams.get('token') ?? ''
      )
      const expected = Buffer.from(this.token)
      if (
        server !== this.http ||
        this.socket ||
        !/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin ?? '') ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      sockets.handleUpgrade(request, socket, head, (extension) => this.attachExtension(extension))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Unable to listen for Chrome.')
    this.pairingUrl = `ws://127.0.0.1:${address.port}/extension?token=${this.token}`
  }

  private attachExtension(socket: WebSocket): void {
    this.socket = socket
    socket.on('message', (raw) => {
      if (this.socket !== socket) return
      try {
        const message = JSON.parse(raw.toString())
        if (message.method === 'ping') {
          socket.send(JSON.stringify({ method: 'pong' }))
          return
        }
        if (typeof message.id === 'number') {
          const pending = this.pending.get(message.id)
          if (!pending) return
          clearTimeout(pending.timer)
          this.pending.delete(message.id)
          if (typeof message.error === 'string') pending.reject(new Error(message.error))
          else pending.resolve(message.result)
          return
        }
        if (message.event && typeof message.event.tabId === 'number') {
          const owner = this.owners.get(message.event.tabId)
          if (owner) {
            this.listeners.get(owner)?.(message.event)
            if (message.event.type === 'detach') this.owners.delete(message.event.tabId)
          }
        }
      } catch (error) {
        console.error('Invalid Chrome extension response.', error)
      }
    })
    socket.on('error', (error) => console.error('Chrome extension connection failed.', error))
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      for (const [id, owner] of this.owners)
        this.listeners.get(owner)?.({ type: 'detach', tabId: id })
      this.owners.clear()
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Chrome was disconnected.'))
      }
      this.pending.clear()
    })
  }

  private request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(
        new Error('Pair the Sele Chrome extension in Settings → Browser & desktop first.')
      )
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Chrome did not respond.'))
      }, 20_000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  createClient(
    scope: BrowserAutomationScope,
    onEvent?: (event: BrowserCdpEvent) => void
  ): BrowserAutomationClient {
    const owner = {}
    let closed = false
    const request = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      if (closed) throw new Error('Chrome capability was revoked.')
      const result = await this.request<T>(method, params)
      if (closed) throw new Error('Chrome capability was revoked.')
      return result
    }
    const downloads = new Map<number, BrowserDownload[]>()
    const authorizedDownloads = new Set<string>()
    this.listeners.set(owner, (event) => {
      if (!closed) onEvent?.(event)
    })
    const tabs = async (): Promise<BrowserAutomationTab[]> => {
      if (closed) throw new Error('Chrome capability was revoked.')
      const all = await request<BrowserAutomationTab[]>('getTabs')
      return all.filter(
        (tab) =>
          !this.detaching.has(tab.id) &&
          (!this.owners.has(tab.id) || this.owners.get(tab.id) === owner)
      )
    }
    const claim = async (id: number): Promise<void> => {
      if (!(await tabs()).some((tab) => tab.id === id))
        throw new Error('This Chrome tab has not been shared or belongs to another conversation.')
      const existing = this.owners.get(id)
      if (closed || (existing && existing !== owner))
        throw new Error('Chrome tab access was revoked.')
      this.owners.set(id, owner)
    }
    const detach = (id: number): void => {
      if (this.owners.get(id) !== owner) return
      this.owners.delete(id)
      this.detaching.add(id)
      void this.request('detach', { tabId: id })
        .catch((error) => console.error('Unable to detach Chrome tab.', error))
        .finally(() => this.detaching.delete(id))
    }
    const client: BrowserAutomationClient = {
      scope: { ...scope },
      listTabs: tabs,
      createTab: async (options) => {
        if (closed) throw new Error('Chrome capability was revoked.')
        const tab = await request<BrowserAutomationTab>('createTab', {
          foreground: options?.foreground ?? true
        })
        if (closed) throw new Error('Chrome capability was revoked.')
        this.owners.set(tab.id, owner)
        return tab
      },
      activateTab: async (id) => {
        await claim(id)
        await request('activateTab', { tabId: id })
      },
      closeTab: async (id) => {
        await claim(id)
        await request('closeTab', { tabId: id })
        this.owners.delete(id)
      },
      visibility: async (visible) => {
        if (visible === false) throw new Error('Chrome visibility is controlled by the user.')
        return { visible: true }
      },
      moveMouse: async (id, x, y) => {
        await claim(id)
        await request('executeCdp', {
          tabId: id,
          method: 'Input.dispatchMouseEvent',
          params: { type: 'mouseMoved', x, y }
        })
      },
      attach: async (id) => {
        await claim(id)
        await request('attach', { tabId: id })
      },
      detach,
      detachAll: () => {
        for (const [id, current] of this.owners) if (current === owner) detach(id)
      },
      executeCdp: async (id, method, params: BrowserCdpParams = {}, sessionId, targetId) => {
        await claim(id)
        if (targetId)
          throw new Error(
            'Non-flattened Chrome target attachment is unsupported. Use flattened sessions.'
          )
        return request('executeCdp', { tabId: id, method, params, sessionId })
      },
      allowDownload: async (id, url) => {
        await claim(id)
        authorizedDownloads.add(url)
        await request('allowDownload', { tabId: id, url })
      },
      listDownloads: async (id) => {
        await claim(id)
        const entries = await request<BrowserDownload[]>('getDownloads', { tabId: id })
        const allowed = entries.filter((entry) => authorizedDownloads.has(entry.url))
        downloads.set(id, allowed)
        return allowed
      },
      waitForDownload: async (id, timeout = 15000) => {
        await claim(id)
        const deadline = Date.now() + Math.min(timeout, 60000)
        while (!closed && Date.now() < deadline) {
          const entries = await request<BrowserDownload[]>('getDownloads', { tabId: id })
          downloads.set(
            id,
            entries.filter((entry) => authorizedDownloads.has(entry.url))
          )
          const complete = downloads.get(id)?.find((entry) => entry.status === 'complete')
          if (complete) return complete
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error('Chrome download did not complete.')
      },
      close: () => {
        if (closed) return
        client.detachAll()
        closed = true
        this.listeners.delete(owner)
      }
    }
    return client
  }

  async disconnect(): Promise<void> {
    this.socket?.terminate()
    this.socket = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Chrome was disconnected.'))
    }
    this.pending.clear()
    this.owners.clear()
    const server = this.http
    this.http = null
    this.pairingUrl = null
    this.token = ''
    this.sockets?.close()
    this.sockets = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  close(): void {
    void this.disconnect().catch((error) =>
      console.error('Unable to close Chrome transport.', error)
    )
  }
}

export const chromeAutomation = new ChromeAutomation()
