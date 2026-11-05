import type { RendererClient } from './clientIpc'
import { appIpcChannels } from '../shared/app'
const clients = new Map<number, RendererClient>()
export const watchWorkspace = (client: RendererClient): void => {
  if (clients.has(client.id)) return
  clients.set(client.id, client)
  client.once('destroyed', () => clients.delete(client.id))
}
export const publishWorkspace = (): void => {
  for (const client of clients.values())
    if (!client.isDestroyed()) client.send(appIpcChannels.workspaceUpdated)
}
