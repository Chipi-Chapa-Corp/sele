import { ipcMain } from 'electron'
import { registerClientRequest, type RendererClient } from './clientIpc'
import { isLocalPreference, preferencesChangedChannel } from '../shared/preferenceSync'
import type { PreferenceChanges } from '../shared/preferences'
import { getDatabase } from './database/sqlite'
import { getPreferenceStorage } from './database/preferenceStorage'
import {
  preferencesChannel,
  type PreferenceRequest,
  type PreferenceResult
} from '../shared/preferences'

export const registerPreferences = async (): Promise<void> => {
  await getDatabase()
  const preferences = await getPreferenceStorage()
  const clients = new Map<number, RendererClient>()
  const track = (client: RendererClient): void => {
    if (clients.has(client.id)) return
    clients.set(client.id, client)
    client.once('destroyed', () => {
      clients.delete(client.id)
      void preferences
        .request({ kind: 'forget', senderId: client.id })
        .catch((error: unknown) => console.warn('Unable to release preference client.', error))
    })
  }
  const currentChanges = async (values: PreferenceChanges): Promise<PreferenceChanges> => {
    const result = await preferences.request<PreferenceResult>({
      kind: 'preferences',
      senderId: 0,
      request: { action: 'load' }
    })
    if (!result.ok) throw new Error(result.error)
    const snapshot = result.value && typeof result.value === 'object' ? result.value : {}
    return Object.fromEntries(Object.keys(values).map((key) => [key, snapshot[key] ?? null]))
  }
  const broadcast = (_origin: number, values: PreferenceChanges): void => {
    const shared = Object.fromEntries(
      Object.entries(values).filter(([key]) => !isLocalPreference(key))
    )
    if (!Object.keys(shared).length) return
    for (const client of clients.values()) {
      if (!client.isDestroyed()) client.send(preferencesChangedChannel, shared)
    }
  }
  let failed = false
  const fail = (error: unknown): PreferenceResult => {
    failed = true
    console.error('Preferences unavailable; saved data has not been reset.', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    event.sender.getType() === 'window' && event.senderFrame === event.sender.mainFrame
  const senders = new WeakSet<Electron.WebContents>()
  const senderId = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): number => {
    if (!senders.has(event.sender)) {
      senders.add(event.sender)
      const id = event.sender.id
      event.sender.once('destroyed', () => {
        void preferences.request({ kind: 'forget', senderId: id }).catch((error: unknown) => {
          console.warn('Unable to release closed-window preference revisions.', error)
        })
      })
    }
    return event.sender.id
  }

  ipcMain.handle(
    preferencesChannel,
    async (event, request: PreferenceRequest): Promise<PreferenceResult> => {
      try {
        if (!trusted(event)) throw new Error('Untrusted preferences request.')
        if (failed)
          throw new Error('Preferences are unavailable. Restart after resolving the storage error.')
        track(event.sender)
        const result = await preferences.request<PreferenceResult>({
          kind: 'preferences',
          request,
          senderId: senderId(event)
        })
        if (result.ok && request.action === 'write')
          broadcast(event.sender.id, await currentChanges(request.values))
        return result
      } catch (error) {
        return fail(error)
      }
    }
  )
  // Authenticated LAN clients use the same durable store, but never migrate
  // device defaults into it or change another device's current navigation.
  registerClientRequest(preferencesChannel, async (event, value: unknown) => {
    const request = value as PreferenceRequest
    if (!request || typeof request !== 'object') throw new Error('Invalid preferences request.')
    track(event.sender)
    if (request.action !== 'load' && request.action !== 'write')
      throw new Error('Invalid remote preference operation.')
    if (request.action === 'write' && Object.keys(request.values).some(isLocalPreference))
      throw new Error('Navigation preferences belong to this device.')
    const result = await preferences.request<PreferenceResult>({
      kind: 'preferences',
      request,
      senderId: event.sender.id
    })
    if (!result.ok) return result
    if (request.action === 'write') broadcast(event.sender.id, await currentChanges(request.values))
    if (request.action === 'load' && result.value && typeof result.value === 'object')
      return {
        ok: true,
        value: Object.fromEntries(
          Object.entries(result.value).filter(([key]) => !isLocalPreference(key))
        )
      }
    return result
  })

  ipcMain.on(preferencesChannel, (event, request: PreferenceRequest) => {
    try {
      if (!trusted(event)) throw new Error('Untrusted preferences request.')
      if (failed)
        throw new Error('Preferences are unavailable. Restart after resolving the storage error.')
      if (request.action !== 'write') throw new Error('Invalid preferences operation.')
      preferences.commitPreferences({ kind: 'preferences', request, senderId: senderId(event) })
      void currentChanges(request.values)
        .then((values) => broadcast(event.sender.id, values))
        .catch(fail)
      event.returnValue = { ok: true, value: null }
    } catch (error) {
      event.returnValue = fail(error)
    }
  })
}
