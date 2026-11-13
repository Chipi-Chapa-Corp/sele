import {
  EncryptedChromePairingStore,
  validatePairing,
  type ChromePairingStore
} from './ChromePairingStore.ts'
import { join } from 'node:path'
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

/** User-paired browser transport with automatic discovery and per-conversation ownership. */
export class ChromeAutomation implements BrowserAutomationService {
  private readonly pairingStore?: ChromePairingStore
  private readonly browserName: 'Chrome' | 'Opera'
  constructor(pairingStore?: ChromePairingStore, browserName: 'Chrome' | 'Opera' = 'Chrome') {
    this.pairingStore = pairingStore
    this.browserName = browserName
  }
  private lifecycle: Promise<unknown> = Promise.resolve()
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(action)
    this.lifecycle = result.catch(() => {})
    return result
  }
  restore(): Promise<boolean> {
    return this.serialized(async () => {
      if (this.http) return true
      const saved = await this.pairingStore?.load()
      if (!saved) return false
      const config = validatePairing(saved)
      await this.listen(config.port, config.token)
      return true
    })
  }
  private http: Server | null = null
  private sockets: WebSocketServer | null = null
  private socket: WebSocket | null = null
  private token = ''
  private pairingUrl: string | null = null
  private extensionEpoch: string | null = null
  private extensionId: string | null = null
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
  private owners = new Map<number, string>()
  private listeners = new Map<object, { owner: string; onEvent(event: BrowserCdpEvent): void }>()

  private emit(owner: string, event: BrowserCdpEvent): void {
    for (const listener of this.listeners.values())
      if (listener.owner === owner) listener.onEvent(event)
  }
  get status(): { connected: boolean; pairingUrl: string | null } {
    return { connected: this.socket?.readyState === WebSocket.OPEN, pairingUrl: this.pairingUrl }
  }
  getConnectionInfo(): { browser: string; connected: boolean; extensionId: string | null } {
    return {
      browser: this.browserName,
      connected: this.status.connected,
      extensionId: this.extensionId
    }
  }

  pair(): Promise<void> {
    return this.serialized(async () => {
      await this.stop()
      await this.pairingStore?.clear()
      try {
        const port = await this.listen(0, randomBytes(32).toString('base64url'))
        await this.pairingStore?.save({ port, token: this.token })
      } catch (error) {
        await this.stop()
        throw error
      }
    })
  }
  private async listen(port: number, token: string): Promise<number> {
    this.token = token
    const server = createServer((_request, response) => response.writeHead(404).end())
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 })
    this.http = server
    this.sockets = sockets
    server.on('upgrade', (request, socket, head) => {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams
      const supplied = Buffer.from(params.get('token') ?? '')
      const epoch = params.get('epoch') ?? ''
      const expected = Buffer.from(this.token)
      if (
        server !== this.http ||
        this.socket ||
        !/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin ?? '') ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(epoch) ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      sockets.handleUpgrade(request, socket, head, (extension) => {
        this.extensionId = request.headers.origin!.slice('chrome-extension://'.length)
        if (this.extensionEpoch !== epoch) {
          for (const [id, owner] of this.owners) this.emit(owner, { type: 'detach', tabId: id })
          this.owners.clear()
          this.extensionEpoch = epoch
        }
        this.attachExtension(extension)
      })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject)
          resolve()
        })
      })
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error(`Unable to listen for ${this.browserName}.`)
      this.pairingUrl = `ws://127.0.0.1:${address.port}/extension?token=${this.token}`
      return address.port
    } catch (error) {
      await this.stop()
      throw error
    }
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
            this.emit(owner, message.event)
            if (message.event.type === 'detach') this.owners.delete(message.event.tabId)
          }
        }
      } catch (error) {
        console.error(`Invalid ${this.browserName} extension response.`, error)
      }
    })
    socket.on('error', (error) =>
      console.error(`${this.browserName} extension connection failed.`, error)
    )
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.extensionId = null
      for (const [id, owner] of this.owners) this.emit(owner, { type: 'detach', tabId: id })
      // A transient transport loss does not transfer tabs to other conversations.
      // Explicit disconnect/pairing still revokes the ownership map below.
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`${this.browserName} was disconnected.`))
      }
      this.pending.clear()
    })
  }

  private request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(
        new Error(
          `Pair the Sele ${this.browserName} extension in Settings → Browser & desktop first.`
        )
      )
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.browserName} did not respond.`))
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
    // A chat keeps its tabs across turns and transport/client replacements.
    // Provider is part of the identity: equal IDs from two providers are unrelated.
    const owner = JSON.stringify([scope.providerId, scope.sessionId, scope.containerKey])
    const listener = {}
    let closed = false
    const request = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      if (closed) throw new Error(`${this.browserName} capability was revoked.`)
      const result = await this.request<T>(method, params)
      if (closed) throw new Error(`${this.browserName} capability was revoked.`)
      return result
    }
    const downloads = new Map<number, BrowserDownload[]>()
    const authorizedDownloads = new Set<string>()
    this.listeners.set(listener, {
      owner,
      onEvent: (event) => {
        if (!closed) onEvent?.(event)
      }
    })
    const tabs = async (): Promise<BrowserAutomationTab[]> => {
      if (closed) throw new Error(`${this.browserName} capability was revoked.`)
      const all = await request<Array<BrowserAutomationTab & { owner?: string }>>('getTabs')
      // Extension session storage is authoritative, including canceled browser control.
      // Claims use extension-side compare-and-set before any tab operation.
      for (const tab of all) {
        const previous = this.owners.get(tab.id)
        if (previous && previous !== tab.owner) {
          this.emit(previous, { type: 'detach', tabId: tab.id })
          this.owners.delete(tab.id)
        }
        if (tab.owner !== undefined) this.owners.set(tab.id, tab.owner)
      }
      return all
        .filter(
          (tab) =>
            !this.detaching.has(tab.id) &&
            (tab.owner === undefined || tab.owner === owner) &&
            (!this.owners.has(tab.id) || this.owners.get(tab.id) === owner)
        )
        .map(({ owner: _allocationOwner, ...tab }) => tab)
    }
    const claim = async (id: number): Promise<void> => {
      if (!(await tabs()).some((tab) => tab.id === id))
        throw new Error(
          `This ${this.browserName} tab is unavailable or belongs to another conversation.`
        )
      const existing = this.owners.get(id)
      if (closed || (existing && existing !== owner))
        throw new Error(`${this.browserName} tab access was revoked.`)
      await request('claimTab', { tabId: id, owner })
      if (closed) throw new Error(`${this.browserName} capability was revoked.`)
      this.owners.set(id, owner)
    }
    const detach = (id: number): void => {
      if (closed || this.owners.get(id) !== owner) return
      // Detaching a debugger is not a transfer of the tab to another chat.
      this.detaching.add(id)
      void this.request('detach', { tabId: id })
        .catch((error) => console.error(`Unable to detach ${this.browserName} tab.`, error))
        .finally(() => this.detaching.delete(id))
    }
    const client: BrowserAutomationClient = {
      scope: { ...scope },
      listTabs: tabs,
      createTab: async (options) => {
        if (closed) throw new Error(`${this.browserName} capability was revoked.`)
        const { owner: allocationOwner, ...tab } = await request<
          BrowserAutomationTab & { owner: string }
        >('createTab', {
          foreground: options?.foreground ?? false,
          owner
        })
        if (allocationOwner !== owner)
          throw new Error(`${this.browserName} tab allocation ownership mismatch.`)
        if (closed) throw new Error(`${this.browserName} capability was revoked.`)
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
        if (visible === false)
          throw new Error(`${this.browserName} visibility is controlled by the user.`)
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
            `Non-flattened ${this.browserName} target attachment is unsupported. Use flattened sessions.`
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
        throw new Error(`${this.browserName} download did not complete.`)
      },
      close: () => {
        if (closed) return
        this.listeners.delete(listener)
        if (![...this.listeners.values()].some((current) => current.owner === owner))
          client.detachAll()
        closed = true
      }
    }
    return client
  }

  disconnect(): Promise<void> {
    return this.serialized(async () => {
      await this.stop()
      await this.pairingStore?.clear()
    })
  }
  private async stop(): Promise<void> {
    this.socket?.terminate()
    this.socket = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`${this.browserName} was disconnected.`))
    }
    this.pending.clear()
    for (const [id, owner] of this.owners) this.emit(owner, { type: 'detach', tabId: id })
    this.owners.clear()
    this.extensionEpoch = null
    this.extensionId = null
    const server = this.http
    this.http = null
    this.pairingUrl = null
    this.token = ''
    this.sockets?.close()
    this.sockets = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  close(): Promise<void> {
    return this.serialized(() => this.stop())
  }
}

export const chromeAutomation = new ChromeAutomation(
  new EncryptedChromePairingStore(
    () => {
      // Lazy Electron access keeps the transport testable without starting Electron.
      return join(chromeUserData(), 'desktop-chrome', 'pairing.enc.json')
    },
    async () => (await import('electron')).safeStorage
  )
)

// Separate listeners, encrypted credentials and ownership maps keep browser-local
// tab IDs isolated. Never rotate the existing Chrome binding when pairing Opera.
export const operaAutomation = new ChromeAutomation(
  new EncryptedChromePairingStore(
    () => join(chromeUserData(), 'desktop-opera', 'pairing.enc.json'),
    async () => (await import('electron')).safeStorage
  ),
  'Opera'
)
export const pairedBrowserAutomations = {
  chrome: chromeAutomation,
  opera: operaAutomation
} as const
function chromeUserData(): string {
  // Set during Electron startup, before restore or pairing is requested.
  if (!userDataPath) throw new Error('Chrome pairing storage has not been initialized.')
  return userDataPath
}
let userDataPath: string | undefined
export function configureChromePairingStorage(path: string): void {
  userDataPath = path
}
