import type {
  PreferenceChanges,
  PreferenceResult,
  PreferencesApi,
  PreferenceValues
} from '../shared/preferences'

type Transport = {
  initialize: (legacy?: PreferenceValues) => Promise<PreferenceResult>
  write: (values: PreferenceChanges) => Promise<PreferenceResult>
  commit: (values: PreferenceChanges) => PreferenceResult
}

const success: PreferenceResult = { ok: true, value: null }

// This snapshot lives in the preload's isolated world. Ordinary renderer reads
// and edits never wait for the main process; only explicit durability barriers do.
export const createPreferenceClient = (transport: Transport): PreferencesApi => {
  let snapshot: Map<string, string> | null = null
  let pending: PreferenceChanges = Object.create(null)
  let writing: PreferenceChanges | null = null
  let inFlight: Promise<PreferenceResult> | null = null
  let failure: PreferenceResult | null = null
  const listeners = new Set<(error: string) => void>()

  const fail = (error: unknown): PreferenceResult => {
    const result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } as const
    if (!failure) {
      failure = result
      listeners.forEach((listener) => listener(result.error))
    }
    return failure
  }
  const ready = (key: string): PreferenceResult | null => {
    if (failure) return failure
    if (!snapshot) return { ok: false, error: 'Preferences have not been initialized.' }
    if (typeof key !== 'string' || !key.startsWith('sele:'))
      return { ok: false, error: 'Invalid preference key.' }
    return null
  }
  const drain = (): Promise<PreferenceResult> => {
    if (failure) return Promise.resolve(failure)
    if (inFlight) return inFlight
    if (!Object.keys(pending).length) return Promise.resolve(success)
    const batch = pending
    pending = Object.create(null)
    writing = batch
    let request: Promise<PreferenceResult>
    try {
      request = transport.write(batch)
    } catch (error) {
      return Promise.resolve(fail(error))
    }
    inFlight = request
      .then((result) => (result.ok ? result : fail(result.error)))
      .catch(fail)
      .then((result) => {
        writing = null
        inFlight = null
        if (result.ok) void drain()
        return result
      })
    return inFlight
  }
  const edit = (key: string, value: string | null): PreferenceResult => {
    const error = ready(key)
    if (error) return error
    if (value !== null && typeof value !== 'string')
      return { ok: false, error: 'Invalid preference value.' }
    if ((snapshot!.get(key) ?? null) === value) return success
    if (value === null) snapshot!.delete(key)
    else snapshot!.set(key, value)
    pending[key] = value
    // Further edits coalesce while a save is in flight. Send the first request
    // now so an unload barrier cannot overtake an unsent older batch.
    void drain()
    return success
  }
  return {
    initialize: async (legacy) => {
      if (snapshot) return { ok: true, value: Object.fromEntries(snapshot) }
      try {
        const result = await transport.initialize(legacy)
        if (!result.ok) return fail(result.error)
        if (result.value !== null) {
          if (typeof result.value !== 'object') return fail('Invalid preference snapshot.')
          snapshot = new Map(Object.entries(result.value))
        }
        return result
      } catch (error) {
        return fail(error)
      }
    },
    getItem: (key) => ready(key) ?? { ok: true, value: snapshot!.get(key) ?? null },
    setItem: (key, value) => edit(key, value),
    removeItem: (key) => edit(key, null),
    flush: async () => {
      do {
        const result = await drain()
        if (!result.ok) return result
      } while (inFlight || Object.keys(pending).length)
      return failure ?? success
    },
    commitPending: () => {
      if (failure) return failure
      const values = { ...writing, ...pending }
      if (!Object.keys(values).length) return success
      try {
        const result = transport.commit(values)
        if (!result.ok) return fail(result.error)
        pending = Object.create(null)
        writing = null
        return result
      } catch (error) {
        return fail(error)
      }
    },
    onFailure: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
