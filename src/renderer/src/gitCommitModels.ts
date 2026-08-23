import type { ProviderId, ProviderModelId } from '../../shared/provider'

export type AppGitCommitModels = Record<string, ProviderModelId | null>

export const appGitLegacyCommitModelKey = '*'

export const getAppGitCommitModelKey = (providerId: ProviderId, environmentKey: string): string =>
  `${providerId}\0${environmentKey}`

export const getAppGitCommitModel = (
  commitModels: AppGitCommitModels,
  providerId: ProviderId,
  environmentKey: string
): ProviderModelId | null => {
  const configurationKey = getAppGitCommitModelKey(providerId, environmentKey)
  if (Object.prototype.hasOwnProperty.call(commitModels, configurationKey)) {
    return commitModels[configurationKey] ?? null
  }

  return commitModels[appGitLegacyCommitModelKey] ?? null
}

export const setAppGitCommitModel = (
  commitModels: AppGitCommitModels,
  providerId: ProviderId,
  environmentKey: string,
  model: ProviderModelId | null
): AppGitCommitModels => ({
  ...commitModels,
  [getAppGitCommitModelKey(providerId, environmentKey)]: model
})
