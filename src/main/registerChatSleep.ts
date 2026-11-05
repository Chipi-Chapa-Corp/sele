import { appIpcChannels } from '../shared/app'
import { chatSleepStorageKey, legacyChatBookmarksStorageKey } from '../shared/chatSleep'
import type { PreferenceResult } from '../shared/preferences'
import type { RendererClient } from './clientIpc'
import { getPreferenceStorage } from './database/preferenceStorage'
import { handleClientRequest } from './logging'
import { createChatSleepState } from './chatSleepState'

export const registerChatSleep = (): void => {
  const clients = new Map<number, RendererClient>()
  let revision = 0
  const source = { senderId: -2147483648, sourceId: 'shared-chat-sleep' }
  const service = createChatSleepState({
    read: async () => {
      const result = await (await getPreferenceStorage()).request<PreferenceResult>({
        kind: 'preferences',
        senderId: source.senderId,
        request: { action: 'load' }
      })
      if (!result.ok) throw new Error(result.error)
      const values = result.value && typeof result.value === 'object' ? result.value : {}
      return {
        sleeping: values[chatSleepStorageKey] ?? null,
        legacy: values[legacyChatBookmarksStorageKey] ?? null
      }
    },
    write: async (value) => {
      const result = await (await getPreferenceStorage()).request<PreferenceResult>({
        kind: 'preferences',
        senderId: source.senderId,
        request: {
          action: 'write',
          sourceId: source.sourceId,
          revision: ++revision,
          values: { [chatSleepStorageKey]: value }
        }
      })
      if (!result.ok) throw new Error(result.error)
    },
    broadcast: (snapshot) => {
      for (const [id, client] of clients) {
        if (client.isDestroyed()) clients.delete(id)
        else {
          try {
            client.send(appIpcChannels.chatSleepUpdated, snapshot)
          } catch (error) {
            clients.delete(id)
            console.warn('Unable to notify sleeping-chat client.', error)
          }
        }
      }
    }
  })
  handleClientRequest(appIpcChannels.getChatSleep, (event) => {
    if (!clients.has(event.sender.id)) {
      clients.set(event.sender.id, event.sender)
      event.sender.once('destroyed', () => clients.delete(event.sender.id))
    }
    return service.getState()
  })
  handleClientRequest(appIpcChannels.updateChatSleep, (_event, changes) => service.update(changes))
}
