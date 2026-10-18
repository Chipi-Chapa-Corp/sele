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
  const revisions = new WeakMap<Electron.WebContents, Map<string, number>>()
  const write = (
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
    request: Extract<PreferenceRequest, { action: 'write' }>
  ): PreferenceResult => {
    if (
      typeof request.sourceId !== 'string' ||
      request.sourceId.length > 64 ||
      !Number.isSafeInteger(request.revision) ||
      request.revision < 1
    )
      throw new Error('Invalid preference write.')
    let sources = revisions.get(event.sender)
    if (!sources) {
      sources = new Map()
      revisions.set(event.sender, sources)
    }
    // Sync unload IPC may overtake an older asynchronous save. Never let that
    // late batch overwrite the newer, already committed document snapshot.
    if (request.revision <= (sources.get(request.sourceId) ?? 0)) return { ok: true, value: null }
    preferences.setMany(request.values)
    sources.set(request.sourceId, request.revision)
    return { ok: true, value: null }
  }

  ipcMain.handle(
    preferencesChannel,
    async (event, request: PreferenceRequest): Promise<PreferenceResult> => {
      try {
        if (!trusted(event)) throw new Error('Untrusted preferences request.')
        if (failed)
          throw new Error('Preferences are unavailable. Restart after resolving the storage error.')
        if (request.action === 'load') return { ok: true, value: preferences.load() }
        if (request.action === 'write') return write(event, request)
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
      if (request.action !== 'write') throw new Error('Invalid preferences operation.')
      event.returnValue = write(event, request)
    } catch (error) {
      event.returnValue = fail(error)
    }
  })
}
