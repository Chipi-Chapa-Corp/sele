import type { PreferencesApi, PreferenceResult, PreferenceValues } from '../../shared/preferences'
import { flushAfterPaintWriters } from './afterPaintWriter.ts'

const api = (): PreferencesApi =>
  (window as unknown as { preferencesApi: PreferencesApi }).preferencesApi

export const showPreferenceFailure = (error: unknown): void => {
  console.error('Unable to use saved preferences.', error)
  if (typeof document === 'undefined') return
  const message = document.createElement('main')
  message.style.cssText = 'padding:32px;font:16px system-ui;white-space:pre-wrap'
  message.textContent =
    'Sele could not load or save your preferences.\n' +
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

const changeListeners = new Set<(keys: ReadonlySet<string>) => void>()
let tracking: Set<string> | null = null
export const trackPreferenceReads = <T>(read: () => T): { value: T; keys: Set<string> } => {
  const previous = tracking
  const keys = new Set<string>()
  tracking = keys
  try {
    return { value: read(), keys }
  } finally {
    tracking = previous
  }
}
export const onPreferencesChanged = (
  listener: (keys: ReadonlySet<string>) => void
): (() => void) => {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}
let watchingClose = false
export const initializePreferences = async (): Promise<void> => {
  if (!watchingClose) {
    watchingClose = true
    api().onChanged?.((changes) => {
      const keys = new Set(Object.keys(changes))
      changeListeners.forEach((listener) => listener(keys))
    })
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
    tracking?.add(key)
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
