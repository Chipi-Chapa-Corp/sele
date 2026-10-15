export const preferencesChannel = 'sele:preferences'

export type PreferenceValues = Record<string, string>
export type PreferenceRequest =
  | { action: 'load' }
  | { action: 'migrate'; values: PreferenceValues }
  | { action: 'get'; key: string }
  | { action: 'set'; key: string; value: string }
  | { action: 'remove'; key: string }

export type PreferenceResult =
  | { ok: true; value: PreferenceValues | string | null }
  | { ok: false; error: string }

export type PreferencesApi = {
  initialize: (legacy?: PreferenceValues) => Promise<PreferenceResult>
  getItem: (key: string) => PreferenceResult
  setItem: (key: string, value: string) => PreferenceResult
  removeItem: (key: string) => PreferenceResult
}
