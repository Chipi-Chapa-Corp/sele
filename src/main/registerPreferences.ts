import { ipcMain } from 'electron'
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
        return await preferences.request<PreferenceResult>({
          kind: 'preferences',
          request,
          senderId: senderId(event)
        })
      } catch (error) {
        return fail(error)
      }
    }
  )
  ipcMain.on(preferencesChannel, (event, request: PreferenceRequest) => {
    try {
      if (!trusted(event)) throw new Error('Untrusted preferences request.')
      if (failed)
        throw new Error('Preferences are unavailable. Restart after resolving the storage error.')
      if (request.action !== 'write') throw new Error('Invalid preferences operation.')
      preferences.commitPreferences({ kind: 'preferences', request, senderId: senderId(event) })
      event.returnValue = { ok: true, value: null }
    } catch (error) {
      event.returnValue = fail(error)
    }
  })
}
