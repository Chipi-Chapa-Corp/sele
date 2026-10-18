export const preferencesChannel = 'sele:preferences'

export type PreferenceValues = Record<string, string>
export type PreferenceChanges = Record<string, string | null>
export type PreferenceRequest =
  | { action: 'load' }
  | { action: 'migrate'; values: PreferenceValues }
  | { action: 'write'; sourceId: string; revision: number; values: PreferenceChanges }

export type PreferenceResult =
  | { ok: true; value: PreferenceValues | string | null }
  | { ok: false; error: string }

export type PreferencesApi = {
  initialize: (legacy?: PreferenceValues) => Promise<PreferenceResult>
  getItem: (key: string) => PreferenceResult
  // Edits update the local snapshot immediately. Await flush for durable storage.
  setItem: (key: string, value: string) => PreferenceResult
  removeItem: (key: string) => PreferenceResult
  flush: () => Promise<PreferenceResult>
  // A synchronous barrier exclusively for document close/reload.
  commitPending: () => PreferenceResult
  onFailure: (listener: (error: string) => void) => () => void
}
