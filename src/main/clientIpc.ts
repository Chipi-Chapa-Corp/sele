import { ipcMain } from 'electron'

/** A renderer connection, backed by either Electron IPC or a network session. */
export type RendererClient = {
  id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
  on(event: 'render-process-gone', listener: () => void): unknown
  on(
    event: 'did-start-navigation',
    listener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void
  ): unknown
  once(event: 'destroyed', listener: () => void): unknown
}

export type ClientEvent = { sender: RendererClient }
type Handler = (event: ClientEvent, ...args: unknown[]) => unknown

// Only operations explicitly registered here are reachable over the network.
// Desktop window controls, dialogs, clipboard, updates and browser automation
// continue to use ordinary Electron IPC and are not included in this registry.
const requests = new Map<string, Handler>()
const messages = new Map<string, Handler>()

export const registerClientRequest = (channel: string, handler: Handler): void => {
  requests.set(channel, handler)
}

export const onClientMessage = (channel: string, handler: Handler): void => {
  messages.set(channel, handler)
  ipcMain.on(channel, handler)
}

export const invokeClientRequest = (
  sender: RendererClient,
  channel: string,
  args: unknown[]
): unknown => {
  const handler = requests.get(channel)
  if (!handler) throw new Error('This operation is only available in the desktop app.')
  return handler({ sender }, ...args)
}

export const receiveClientMessage = (
  sender: RendererClient,
  channel: string,
  args: unknown[]
): void => {
  const handler = messages.get(channel)
  if (!handler) throw new Error('Unsupported client message.')
  handler({ sender }, ...args)
}
