import type { ProviderId, ProviderModelId } from '../../shared/provider'

export type AccountModelPreferences = Record<string, ProviderModelId>

const storageKey = 'sele:account-model-preferences:v1'

export const getAccountModelPreferenceKey = (
  providerId: ProviderId,
  containerKey: string,
  accountId: string
): string => JSON.stringify([providerId, containerKey, accountId])

export const readAccountModelPreferences = (
  storage?: Pick<Storage, 'getItem'>
): AccountModelPreferences => {
  try {
    const value = JSON.parse((storage ?? window.localStorage).getItem(storageKey) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[1].trim().length > 0
      )
    )
  } catch (error) {
    console.error('Unable to read account model preferences.', error)
    return {}
  }
}

export const writeAccountModelPreferences = (
  preferences: AccountModelPreferences,
  storage?: Pick<Storage, 'setItem'>
): void => {
  try {
    ;(storage ?? window.localStorage).setItem(storageKey, JSON.stringify(preferences))
  } catch (error) {
    console.error('Unable to store account model preferences.', error)
  }
}
