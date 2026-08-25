import type { ProviderActiveSendMode } from '../../shared/provider'

export const getModifiedActiveSendMode = (
  activePrimaryMode: Extract<ProviderActiveSendMode, 'steer' | 'queue'>,
  activeSteeringEnabled: boolean,
  controlPressed: boolean
): Extract<ProviderActiveSendMode, 'steer' | 'queue'> =>
  activePrimaryMode === 'queue' && activeSteeringEnabled && controlPressed
    ? 'steer'
    : activePrimaryMode
