import type { ProviderActiveSendMode } from '../../shared/provider'

export const getModifiedActiveSendMode = (
  activePrimaryMode: Extract<ProviderActiveSendMode, 'steer' | 'queue'>,
  activeSteeringEnabled: boolean,
  controlPressed: boolean
): Extract<ProviderActiveSendMode, 'steer' | 'queue'> => {
  if (!controlPressed) return activePrimaryMode
  if (activePrimaryMode === 'steer') return 'queue'
  return activeSteeringEnabled ? 'steer' : 'queue'
}
