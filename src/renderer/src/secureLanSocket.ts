import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type LanSocket = Pick<
  WebSocket,
  'readyState' | 'onopen' | 'onmessage' | 'onerror' | 'onclose' | 'send' | 'close'
> & { readonly connectionFailure?: string }
type SocketEvent = { id: string; type: string; data?: string; code: number; failure?: string }
const native = registerPlugin<{
  inspect(options: { origin: string }): Promise<{ fingerprint: string }>
  open(options: { id: string; url: string; fingerprint: string }): Promise<void>
  send(options: { id: string; data: string }): Promise<void>
  close(options: { id: string }): Promise<void>
  addListener(
    name: 'socketEvent',
    listener: (event: SocketEvent) => void
  ): Promise<PluginListenerHandle>
}>('SecureLan')

export const inspectComputerCertificate = async (
  origin: string,
  signal: AbortSignal
): Promise<string> => {
  if (new URL(origin).protocol !== 'https:')
    throw new Error('Update desktop Sele to use an encrypted connection.')
  const result = Capacitor.isNativePlatform()
    ? await native.inspect({ origin })
    : await fetch(`${origin}/sele/identity`, { signal, cache: 'no-store', redirect: 'error' }).then(
        (response) => {
          if (!response.ok) throw new Error('Update desktop Sele before pairing.')
          return response.json() as Promise<{ fingerprint: string }>
        }
      )
  if (signal.aborted) throw new Error('Pairing canceled.')
  if (!/^[a-f0-9]{64}$/.test(result.fingerprint)) throw new Error('Invalid computer certificate.')
  return result.fingerprint
}

class PinnedLanSocket implements LanSocket {
  readyState: number = WebSocket.CONNECTING
  connectionFailure?: string
  onopen: WebSocket['onopen'] = null
  onmessage: WebSocket['onmessage'] = null
  onerror: WebSocket['onerror'] = null
  onclose: WebSocket['onclose'] = null
  private id = crypto.randomUUID()
  private listener?: PluginListenerHandle
  private closed = false

  constructor(url: string, fingerprint: string) {
    void this.open(url, fingerprint)
  }

  private finish(code: number, failure?: string): void {
    if (this.closed) return
    this.closed = true
    this.readyState = WebSocket.CLOSED
    this.connectionFailure = failure
    void this.listener?.remove().catch(() => {})
    void native.close({ id: this.id }).catch(() => {})
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close', { code }))
  }

  private async open(url: string, fingerprint: string): Promise<void> {
    try {
      this.listener = await native.addListener('socketEvent', (event) => {
        if (event.id !== this.id || this.closed) return
        const self = this as unknown as WebSocket
        if (event.type === 'open') {
          this.readyState = WebSocket.OPEN
          this.onopen?.call(self, new Event('open'))
        } else if (event.type === 'message') {
          this.onmessage?.call(self, new MessageEvent('message', { data: event.data }))
        } else if (event.type === 'certificateError') this.finish(4003)
        else if (event.type === 'close' || event.type === 'error')
          this.finish(event.code || 1006, event.failure)
      })
      if (this.closed) {
        await this.listener.remove()
        return
      }
      await native.open({ id: this.id, url, fingerprint })
      if (this.closed) await native.close({ id: this.id })
    } catch (error) {
      console.warn('Unable to open the Android connection to Sele.', error)
      this.finish(
        1006,
        'Android could not open an encrypted connection to Sele. Try reopening the app.'
      )
    }
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== WebSocket.OPEN || typeof data !== 'string')
      throw new Error('Sele is disconnected.')
    void native.send({ id: this.id, data }).catch(() => this.finish(1006))
  }

  close(): void {
    this.finish(1000)
  }
}

export const createLanSocket = (url: string, fingerprint?: string): LanSocket => {
  if (new URL(url).protocol !== 'wss:') throw new Error('An encrypted Sele connection is required.')
  if (!Capacitor.isNativePlatform()) return new WebSocket(url)
  if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint))
    throw new Error('Pair this computer again to verify its certificate.')
  return new PinnedLanSocket(url, fingerprint)
}
