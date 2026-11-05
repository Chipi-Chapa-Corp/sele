import type { RendererTransport } from '../../shared/rendererBridge'
import {
  decodeClientMessage,
  encodeClientMessage,
  localAccessProtocolVersion
} from '../../shared/localAccess'

/** Requests are deliberately never queued or retried across connections. */
export class LanTransport implements RendererTransport {
  private socket: WebSocket | null = null
  private ready = false
  private connectedBefore = false
  private stopped = false
  private nextId = 1
  private reconnectDelay = 500
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Map<string, Map<unknown, (args: unknown[]) => void>>()
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
    private onAccessRevoked?: () => void
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const socket = new WebSocket(this.url)
      this.socket = socket
      const timeout = setTimeout(() => socket.close(), 10_000)
      socket.onopen = () =>
        socket.send(
          encodeClientMessage({
            type: 'hello',
            version: localAccessProtocolVersion,
            token: this.token
          })
        )
      socket.onmessage = (event) => {
        try {
          const message = decodeClientMessage(event.data)
          if (message.type === 'ready' && message.version === localAccessProtocolVersion) {
            clearTimeout(timeout)
            this.ready = true
            this.reconnectDelay = 500
            this.onStatus(null)
            settled = true
            resolve()
            if (this.connectedBefore) this.onReconnect()
            this.connectedBefore = true
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
            this.listeners
              .get(message.channel)
              ?.forEach((listener) => listener([undefined, ...(message.args as unknown[])]))
          }
        } catch (error) {
          console.error('Unable to apply a local-access message.', error)
          socket.close()
        }
      }
      socket.onerror = () => socket.close()
      socket.onclose = (event) => {
        clearTimeout(timeout)
        this.ready = false
        const error = new Error(
          event.code === 1008
            ? 'Device access is invalid or was revoked. Request access again from Sele on your computer.'
            : 'Connection lost. A request may have completed on the host; check its status before trying again.'
        )
        this.pending.forEach((request) => {
          clearTimeout(request.timer)
          request.reject(error)
        })
        this.pending.clear()
        if (!settled) reject(error)
        if (this.stopped) return
        if (this.connectedBefore && event.code === 1008 && this.onAccessRevoked) {
          this.onAccessRevoked()
          return
        }
        this.onStatus(event.code === 1008 ? error.message : 'Disconnected from Sele. Reconnecting…')
        if (this.connectedBefore && event.code !== 1008) {
          this.reconnectTimer = setTimeout(() => {
            void this.connect().catch((error) =>
              console.warn('Unable to reconnect to Sele.', error)
            )
          }, this.reconnectDelay)
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000)
        }
      }
    })
  }

  invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    if (!this.ready || !this.socket) return Promise.reject(new Error('Sele is disconnected.'))
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
        console.error('Unable to send a local-access request.', error)
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  send(channel: string, ...args: unknown[]): void {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(encodeClientMessage({ type: 'send', channel, args }))
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
    this.socket?.close()
  }
}
