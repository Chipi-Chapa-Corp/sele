import type { ProviderRendererApi } from '../../shared/provider'

type ProviderWindow = Window & {
  providerApi: ProviderRendererApi
}

export const providerApi = (window as unknown as ProviderWindow).providerApi
