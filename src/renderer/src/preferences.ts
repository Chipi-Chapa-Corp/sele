import type { PreferencesApi, PreferenceResult, PreferenceValues } from '../../shared/preferences'
import { flushAfterPaintWriters } from './afterPaintWriter.ts'

const api = (): PreferencesApi => {
  const api = (window as Window & { preferencesApi?: PreferencesApi }).preferencesApi
  if (!api) throw new Error('Restart Sele to finish updating preference storage.')
  return api
}

export const showPreferenceFailure = (error: unknown): void => {
  console.error('Unable to use saved preferences.', error)
  if (typeof document === 'undefined') return
  const message = document.createElement('main')
  message.style.cssText = 'padding:32px;font:16px system-ui;white-space:pre-wrap'
  message.textContent =
    error instanceof Error &&
    error.message === 'Restart Sele to finish updating preference storage.'
      ? 'Restart Sele to finish this update.'
      : 'Sele could not load or save your preferences.\n' +
        'Saved preferences have not been reset. Close Sele and resolve the storage error before continuing.\n\n' +
        (error instanceof Error ? error.message : String(error))
  document.body.replaceChildren(message)
}

const unwrap = (result: PreferenceResult): PreferenceValues | string | null => {
  if (result.ok) return result.value
  const error = new Error(result.error)
  showPreferenceFailure(error)
  throw error
}

export const flushPreferences = async (): Promise<void> => {
  flushAfterPaintWriters()
  unwrap(await api().flush())
}

let watchingClose = false
export const initializePreferences = async (): Promise<void> => {
  if (typeof api().flush !== 'function')
    throw new Error('Restart Sele to finish updating preference storage.')
  if (!watchingClose) {
    watchingClose = true
    api().onFailure((error) => showPreferenceFailure(new Error(error)))
    window.addEventListener('beforeunload', (event) => {
      try {
        flushAfterPaintWriters()
        // Only closing/reloading needs a synchronous durability barrier. Normal
        // navigation, input, and resizing use local reads and asynchronous saves.
        unwrap(api().commitPending())
      } catch (error) {
        event.preventDefault()
        showPreferenceFailure(error)
      }
    })
  }
  if (unwrap(await api().initialize()) !== null) return
  // Read Chromium only for the first migration. Once migrated, even a completely
  // recreated Chromium profile is irrelevant to these preferences.
  const legacy: PreferenceValues = {}
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith('sele:')) continue
    const value = window.localStorage.getItem(key)
    if (value !== null) legacy[key] = value
  }
  unwrap(await api().initialize(legacy))
}

export const preferences: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: (key) => {
    const value = unwrap(api().getItem(key))
    if (value !== null && typeof value !== 'string') throw new Error('Invalid preference response.')
    return value
  },
  setItem: (key, value) => {
    unwrap(api().setItem(key, value))
  },
  removeItem: (key) => {
    unwrap(api().removeItem(key))
  }
}
