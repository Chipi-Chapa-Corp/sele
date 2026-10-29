import { createContext, useContext } from 'react'
import type { ProviderId } from '../../shared/provider'
import { providerLabels } from './providerSettings'

export const getProviderLabels = (_available: readonly ProviderId[]): Record<ProviderId, string> =>
  providerLabels
export const ProviderLabelsContext = createContext<Record<ProviderId, string>>(providerLabels)
export const useProviderLabels = (): Record<ProviderId, string> => useContext(ProviderLabelsContext)
