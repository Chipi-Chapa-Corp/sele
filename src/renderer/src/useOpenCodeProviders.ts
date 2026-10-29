import { useEffect, useMemo, useState } from 'react'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderModel, ProviderId } from '../../shared/provider'
import type { ProviderConnection } from '../../shared/providerConnections'
import { providerApi } from './providerApi'
import { getContainerTargetKey } from './containerSelection'
import {
  getOpenCodeProviders,
  readOpenCodeProviderPreferences,
  selectOpenCodeProvider,
  writeOpenCodeProviderPreferences
} from './openCodeProviderPreferences'

export function useOpenCodeProviders({
  enabled,
  providerId = 'opencode-v2',
  container,
  models,
  model,
  revision
}: {
  enabled: boolean
  providerId?: ProviderId
  container: AppContainerTarget | null
  models: ProviderModel[]
  model: string
  revision: number
}) {
  const [remembered, setRemembered] = useState(readOpenCodeProviderPreferences)
  const [snapshot, setSnapshot] = useState<{
    sourceKey: string
    connections: ProviderConnection[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sourceKey = JSON.stringify([providerId, container])
  const targetKey = `${providerId}:${getContainerTargetKey(container)}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision reloads changed connections
  useEffect(() => {
    if (!enabled) return
    let active = true
    setError(null)
    void providerApi
      .getConnections(providerId, { container: JSON.parse(sourceKey)[1] })
      .then((connections) => {
        if (active) setSnapshot({ sourceKey, connections })
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : 'Unable to load providers.')
      })
    return () => {
      active = false
    }
  }, [enabled, providerId, sourceKey, revision])
  const providers = useMemo(
    () =>
      enabled
        ? getOpenCodeProviders(
            snapshot?.sourceKey === sourceKey ? snapshot.connections : [],
            models
          )
        : [],
    [enabled, snapshot, sourceKey, models]
  )
  const selectedId = selectOpenCodeProvider(
    providers,
    remembered[targetKey] ??
      (providerId === 'opencode-v2' ? remembered[getContainerTargetKey(container)] : undefined),
    model
  )
  const select = (id: string): void => {
    const next = { ...remembered, [targetKey]: id }
    writeOpenCodeProviderPreferences(next)
    setRemembered(next)
  }
  const loading = enabled && snapshot?.sourceKey !== sourceKey && !error
  return { providers, selectedId, select, error, loading }
}
