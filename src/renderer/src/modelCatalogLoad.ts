import type { ProviderModel } from '../../shared/provider'

export type ProviderModelCatalogLoadResult = {
  models: ProviderModel[]
  error: string | null
  cache: boolean
}

export const resolveProviderModelCatalogSuccess = (
  discoveredModels: ProviderModel[],
  fallbackModels: ProviderModel[]
): ProviderModelCatalogLoadResult => ({
  models: discoveredModels.length > 0 ? discoveredModels : fallbackModels,
  error: null,
  cache: true
})

export const resolveProviderModelCatalogFailure = (
  cachedModels: ProviderModel[] | undefined,
  fallbackModels: ProviderModel[],
  error: string
): ProviderModelCatalogLoadResult => ({
  models: cachedModels ?? fallbackModels,
  error,
  cache: false
})
