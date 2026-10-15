import { ipcMain } from 'electron'
import { getDatabase, getSqliteConnection } from './database/sqlite'
import { openPreferences } from './database/preferences'
import {
  preferencesChannel,
  type PreferenceRequest,
  type PreferenceResult
} from '../shared/preferences'

export const registerPreferences = async (): Promise<void> => {
  await getDatabase()
  const preferences = openPreferences(getSqliteConnection())
  let failed = false
  const fail = (error: unknown): PreferenceResult => {
    failed = true
    console.error('Preferences unavailable; saved data has not been reset.', error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    event.sender.getType() === 'window' && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(
    preferencesChannel,
    async (event, request: PreferenceRequest): Promise<PreferenceResult> => {
      try {
        if (!trusted(event)) throw new Error('Untrusted preferences request.')
        if (failed)
          throw new Error('Preferences are unavailable. Restart after resolving the storage error.')
        if (request.action === 'load') return { ok: true, value: preferences.load() }
        if (request.action !== 'migrate') throw new Error('Invalid preferences initialization.')
        const values = preferences.migrate(request.values)
        return { ok: true, value: values }
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
      if (request.action === 'get')
        event.returnValue = { ok: true, value: preferences.get(request.key) }
      else if (request.action === 'set' || request.action === 'remove') {
        preferences.set(request.key, request.action === 'set' ? request.value : null)
        event.returnValue = { ok: true, value: null }
      } else throw new Error('Invalid preferences operation.')
    } catch (error) {
      event.returnValue = fail(error)
    }
  })
}
