import type { PreferencesApi, PreferenceResult, PreferenceValues } from '../../shared/preferences'

/** Device-specific preferences and drafts must survive phone suspension offline. */
export const createLocalPreferences = (storage: Storage, namespace = ''): PreferencesApi => {
  const listeners = new Set<(error: string) => void>()
  let failure: PreferenceResult | null = null
  const run = (operation: () => PreferenceValues | string | null): PreferenceResult => {
    if (failure) return failure
    try {
      return { ok: true, value: operation() }
    } catch (error) {
      console.error('Unable to use browser preferences.', error)
      const message = error instanceof Error ? error.message : String(error)
      failure = { ok: false, error: message }
      listeners.forEach((listener) => listener(message))
      return failure
    }
  }
  const key = (value: string): string => {
    if (typeof value !== 'string' || !value.startsWith('sele:'))
      throw new Error('Invalid preference key.')
    return value
  }
  return {
    initialize: async () =>
      run(() => {
        const values: PreferenceValues = {}
        for (let index = 0; index < storage.length; index++) {
          const storedName = storage.key(index)
          if (!storedName?.startsWith(namespace)) continue
          const name = storedName.slice(namespace.length)
          if (name.startsWith('sele:')) values[name] = storage.getItem(storedName)!
        }
        return values
      }),
    getItem: (name) => run(() => storage.getItem(namespace + key(name))),
    setItem: (name, value) =>
      run(() => {
        storage.setItem(namespace + key(name), value)
        return null
      }),
    removeItem: (name) =>
      run(() => {
        storage.removeItem(namespace + key(name))
        return null
      }),
    flush: async () => failure ?? { ok: true, value: null },
    commitPending: () => failure ?? { ok: true, value: null },
    onFailure: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
