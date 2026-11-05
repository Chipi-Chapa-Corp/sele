import { localNetwork as native } from './nativeLocalNetwork'
import type { PreferenceResult, PreferencesApi } from '../../shared/preferences'
import { createLocalPreferences } from './localPreferences'

let values: Record<string, string> = {}
let pending = Promise.resolve()
let failure: string | null = null
const failures = new Set<(error: string) => void>()

export const initializeAndroidStorage = async (): Promise<void> => {
  values = (await native.readStorage()).values
}
export const readAndroidStorage = (key: string): string | null => values[key] ?? null
export const writeAndroidStorage = (key: string, value: string | null): Promise<void> => {
  if (value === null) delete values[key]
  else values[key] = value
  // Native SharedPreferences commits before acknowledging. Serialize writes so
  // rapid typing and host changes cannot persist an older value over a new one.
  pending = pending
    .then(() => native.writeStorage({ key, value }))
    .catch((error) => {
      console.error('Unable to persist Android Sele storage.', error)
      failure = error instanceof Error ? error.message : String(error)
      failures.forEach((listener) => listener(failure!))
      throw error
    })
  void pending.catch((error) => console.warn('Android storage requires attention.', error))
  return pending
}
export const createAndroidPreferences = (namespace: string): PreferencesApi => {
  const memory: Storage = {
    get length() {
      return Object.keys(values).length
    },
    key: (index) => Object.keys(values)[index] ?? null,
    getItem: readAndroidStorage,
    setItem: (key, value) => {
      void writeAndroidStorage(key, value).catch((error) =>
        console.warn('Android preference save failed.', error)
      )
    },
    removeItem: (key) => {
      void writeAndroidStorage(key, null).catch((error) =>
        console.warn('Android preference removal failed.', error)
      )
    },
    clear: () => {
      throw new Error('Clearing all device storage is unsupported.')
    }
  }
  const base = createLocalPreferences(memory, namespace)
  const result = (): PreferenceResult =>
    failure ? { ok: false, error: failure } : { ok: true, value: null }
  return {
    ...base,
    flush: async () => {
      await pending.catch((error) => console.warn('Unable to flush Android preferences.', error))
      return result()
    },
    commitPending: result,
    onFailure: (listener) => {
      failures.add(listener)
      return () => {
        failures.delete(listener)
      }
    }
  }
}
