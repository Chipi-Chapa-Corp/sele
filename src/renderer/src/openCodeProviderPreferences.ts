import type { ProviderModel } from '../../shared/provider'
import {
  connectionServesModels,
  type ProviderConnection
} from '../../shared/providerConnections.ts'
import { preferences } from './preferences.ts'

const storageKey = 'sele:opencode-provider-preferences:v1'

export const readOpenCodeProviderPreferences = (
  storage: Pick<Storage, 'getItem'> = preferences
): Record<string, string> => {
  try {
    const value: unknown = JSON.parse(storage.getItem(storageKey) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((entry) => typeof entry[1] === 'string' && entry[1])
    )
  } catch (error) {
    console.error('Unable to read OpenCode provider preferences.', error)
    return {}
  }
}

export const writeOpenCodeProviderPreferences = (
  value: Record<string, string>,
  storage: Pick<Storage, 'setItem'> = preferences
): void => {
  storage.setItem(storageKey, JSON.stringify(value))
}

export const getOpenCodeModelProviderId = (modelId: string): string => {
  const separator = modelId.indexOf('/')
  return separator > 0 ? modelId.slice(0, separator) : ''
}

export const getOpenCodeProviders = (
  connections: ProviderConnection[],
  models: ProviderModel[]
): ProviderConnection[] => {
  const providers = new Map(
    connections
      .filter((provider) => provider.connections.some(connectionServesModels))
      .map((provider) => [provider.id, provider])
  )
  for (const model of models) {
    const id = getOpenCodeModelProviderId(model.id)
    if (!id || providers.has(id)) continue
    providers.set(
      id,
      connections.find((provider) => provider.id === id) ?? {
        id,
        name: model.modelProvider?.name ?? id,
        methods: [],
        connections: []
      }
    )
  }
  return [...providers.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const selectOpenCodeProvider = (
  providers: ProviderConnection[],
  remembered: string | undefined,
  model: string
): string => {
  if (remembered && providers.some((provider) => provider.id === remembered)) return remembered
  const modelProvider = getOpenCodeModelProviderId(model)
  return providers.find((provider) => provider.id === modelProvider)?.id ?? providers[0]?.id ?? ''
}

export const filterOpenCodeModels = (
  models: ProviderModel[],
  providerId: string
): ProviderModel[] => models.filter((model) => getOpenCodeModelProviderId(model.id) === providerId)
