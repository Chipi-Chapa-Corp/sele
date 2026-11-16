import type { RendererTransport } from '../../shared/rendererBridge'
import {
  decodeClientMessage,
  encodeClientMessage,
  localAccessProtocolVersion
} from '../../shared/localAccess'

export class LanConnectionError extends Error {}
export class LanAccessRevokedError extends LanConnectionError {}

/** Only connection setup is retried. Sent requests are never replayed. */
export class LanTransport implements RendererTransport {
  private socket: WebSocket | null = null
  private ready = false
  private connectedBefore = false
  private stopped = false
  private revoked = false
  private endpoints: string[] = []
  private sessionId = crypto.randomUUID()
  private nextId = 1
  private reconnectDelay = 500
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatDeadline: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimeout = 0
  private heartbeatSupported = false
  private connection: Promise<void> | null = null
  private cancelConnection: (() => void) | null = null
  private listeners = new Map<string, Map<unknown, (args: unknown[]) => void>>()
  private readyWaiters = new Set<{ resolve(): void; reject(error: Error): void }>()
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(
    private url: string,
    private token: string,
    private onStatus: (message: string | null) => void,
    private onReconnect: () => void,
    private onAccessRevoked?: () => void,
    private deviceId?: string
  ) {}

  get isReady(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN
  }

  get endpoint(): string {
    return this.url
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline)
    this.heartbeatTimer = this.heartbeatDeadline = null
    this.heartbeatTimeout = 0
  }

  /** A foreground probe detects a half-open Wi-Fi connection without reloading. */
  resume(): void {
    if (this.stopped || this.revoked) return
    if (this.isReady) {
      if (this.heartbeatSupported) this.probe(2000)
    } else if (!this.connection) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
      void this.connect().catch(() => {})
    }
  }

  updateUrl(url: string): void {
    if (url === this.url) return
    // Discovery disappearing or changing must never interrupt a healthy socket.
    if (!this.isReady) {
      this.cancelConnection?.()
      this.url = url
      this.resume()
    } else this.url = url
  }

  updateEndpoints(urls: string[]): void {
    const endpoints = [...new Set(urls)]
    if (!endpoints.length || JSON.stringify(endpoints) === JSON.stringify(this.endpoints)) return
    this.endpoints = endpoints
    if (!this.isReady) this.updateUrl(endpoints[0])
  }

  private probe(timeout = 10_000): void {
    const socket = this.socket
    if (!socket || !this.isReady) return
    // Visibility/pageshow/online can arrive together. Keep the earliest probe
    // instead of postponing recovery on every lifecycle event.
    if (this.heartbeatDeadline && this.heartbeatTimeout <= timeout) return
    this.clearHeartbeat()
    this.heartbeatTimeout = timeout
    this.heartbeatDeadline = setTimeout(() => {
      if (this.socket !== socket) return
      this.cancelConnection?.()
      // A confirmed stale socket does not need an additional retry backoff.
      this.resume()
    }, timeout)
    try {
      socket.send(encodeClientMessage({ type: 'ping' }))
    } catch {
      this.cancelConnection?.()
    }
  }

  connect(): Promise<void> {
    if (this.stopped || this.revoked)
      return Promise.reject(new LanConnectionError('Sele is disconnected.'))
    if (this.isReady) return Promise.resolve()
    if (this.connection) return this.connection
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    let resolveConnection!: () => void
    let rejectConnection!: (error: Error) => void
    const connection = new Promise<void>((resolve, reject) => {
      resolveConnection = resolve
      rejectConnection = reject
    })
    this.connection = connection
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch (error) {
      this.connection = null
      rejectConnection(error instanceof Error ? error : new Error(String(error)))
      return connection
    }
    this.socket = socket
    let finished = false
    const timeout = setTimeout(() => disconnect(1006), 4000)
    const disconnect = (code: number): void => {
      if (finished || this.socket !== socket) return
      finished = true
      clearTimeout(timeout)
      this.clearHeartbeat()
      this.ready = false
      this.socket = null
      this.connection = null
      this.cancelConnection = null
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null
      socket.close()
      const error =
        code === 1008
          ? new LanAccessRevokedError(
              'Device access is invalid or was revoked. Request access again on your computer.'
            )
          : new LanConnectionError(
              'Connection lost. A request may have completed on your computer; check before trying again.'
            )
      this.pending.forEach((request) => {
        clearTimeout(request.timer)
        request.reject(error)
      })
      this.pending.clear()
      rejectConnection(error)
      if (this.stopped) return
      if (code === 1008) {
        this.revoked = true
        this.readyWaiters.forEach((waiter) => waiter.reject(error))
        this.readyWaiters.clear()
        this.onStatus(error.message)
        if (this.connectedBefore) this.onAccessRevoked?.()
        return
      }
      this.onStatus('Reconnecting to Sele…')
      if (this.endpoints.length > 1) {
        this.url = this.endpoints[(this.endpoints.indexOf(this.url) + 1) % this.endpoints.length]
      }
      // Retry initial connections too: a sleeping device can return later.
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        void this.connect().catch(() => {})
      }, this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000)
    }
    this.cancelConnection = () => disconnect(1006)
    socket.onopen = () => {
      if (this.socket !== socket) return
      socket.send(
        encodeClientMessage({
          type: 'hello',
          version: localAccessProtocolVersion,
          sessionId: this.sessionId,
          ...(this.deviceId ? { deviceId: this.deviceId } : {}),
          token: this.token
        })
      )
    }
    socket.onmessage = (event) => {
      if (this.socket !== socket) return
      try {
        const message = decodeClientMessage(event.data)
        if (message.type === 'ready' && message.version === localAccessProtocolVersion) {
          if (this.ready) return
          clearTimeout(timeout)
          this.ready = true
          this.connection = null
          this.heartbeatSupported = message.heartbeat === true
          this.reconnectDelay = 500
          this.onStatus(null)
          this.readyWaiters.forEach((waiter) => waiter.resolve())
          this.readyWaiters.clear()
          resolveConnection()
          if (this.heartbeatSupported) this.heartbeatTimer = setTimeout(() => this.probe(), 15_000)
          const reconnecting = this.connectedBefore
          this.connectedBefore = true
          if (reconnecting) this.onReconnect()
        } else if (message.type === 'pong') {
          this.clearHeartbeat()
          this.heartbeatTimer = setTimeout(() => this.probe(), 15_000)
        } else if (message.type === 'result' && typeof message.id === 'number') {
          const request = this.pending.get(message.id)
          if (!request) return
          this.pending.delete(message.id)
          clearTimeout(request.timer)
          if (typeof message.error === 'string') request.reject(new Error(message.error))
          else request.resolve(message.result)
        } else if (
          message.type === 'event' &&
          typeof message.channel === 'string' &&
          Array.isArray(message.args)
        ) {
          this.emit(message.channel, ...message.args)
        }
      } catch (error) {
        console.error('Unable to apply a local-access message.', error)
        disconnect(1006)
      }
    }
    socket.onerror = () => disconnect(1006)
    socket.onclose = (event) => disconnect(event.code)
    return connection
  }

  invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (!this.isReady || !this.socket)
      return Promise.reject(new LanConnectionError('Sele is disconnected.'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The request timed out. Check its status before trying again.'))
      }, 5 * 60_000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      try {
        this.socket!.send(encodeClientMessage({ type: 'invoke', id, channel, args }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new LanConnectionError(error instanceof Error ? error.message : String(error)))
      }
    })
  }

  waitUntilReady(): Promise<void> {
    if (this.isReady) return Promise.resolve()
    if (this.revoked)
      return Promise.reject(
        new LanAccessRevokedError(
          'Device access was revoked. Request access again on your computer.'
        )
      )
    if (this.stopped) return Promise.reject(new LanConnectionError('Sele is disconnected.'))
    this.resume()
    return new Promise((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timer)
        this.readyWaiters.delete(waiter)
        if (error) reject(error)
        else resolve()
      }
      const waiter = { resolve: () => finish(), reject: (error: Error) => finish(error) }
      const timer = setTimeout(
        () => finish(new LanConnectionError('Sele is disconnected. Try again after reconnecting.')),
        15_000
      )
      this.readyWaiters.add(waiter)
    })
  }

  send(channel: string, ...args: unknown[]): void {
    if (!this.isReady) return
    this.socket!.send(encodeClientMessage({ type: 'send', channel, args }))
  }

  emit(channel: string, ...args: unknown[]): void {
    this.listeners.get(channel)?.forEach((listener) => {
      try {
        listener([undefined, ...args])
      } catch (error) {
        console.error('Unable to apply a local-access event.', channel, error)
      }
    })
  }

  hasListeners(channel: string): boolean {
    return Boolean(this.listeners.get(channel)?.size)
  }

  on<T extends unknown[]>(channel: string, listener: (...args: T) => void): void {
    const listeners = this.listeners.get(channel) ?? new Map()
    listeners.set(listener, (args: unknown[]) => listener(...(args as T)))
    this.listeners.set(channel, listeners)
  }

  removeListener<T extends unknown[]>(channel: string, listener: (...args: T) => void): void {
    this.listeners.get(channel)?.delete(listener)
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.clearHeartbeat()
    this.readyWaiters.forEach((waiter) =>
      waiter.reject(new LanConnectionError('Sele is disconnected.'))
    )
    this.readyWaiters.clear()
    this.cancelConnection?.()
  }
}
