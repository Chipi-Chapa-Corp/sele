import { useEffect, useState } from 'react'
import type { AppContainerTarget } from '../../shared/app'
import type { ProviderId } from '../../shared/provider'
import {
  getOpenCodeConnectionFailure,
  openCodeConnectionsNeedCheck,
  type ProviderConnection
} from '../../shared/providerConnections'
import { getContainerTargetKey } from './containerSelection'
import { providerApi } from './providerApi'

export function useOpenCodeConnectionHealth({
  providerId,
  container,
  available,
  model,
  revision,
  chatKey
}: {
  providerId: ProviderId
  container: AppContainerTarget
  available: boolean
  model: string
  revision: number
  chatKey: string | null
}): { name: string; message: string } | null {
  const sourceKey = JSON.stringify(container)
  // Revalidation must not hide a known failure while the same source is being refreshed.
  const scope = `${providerId}:${getContainerTargetKey(container)}`
  const [result, setResult] = useState<{ scope: string; providers: ProviderConnection[] } | null>(
    null
  )

  // Re-read cached health when opening a chat or changing models within the same target.
  // biome-ignore lint/correctness/useExhaustiveDependencies: model, chatKey and revision intentionally trigger fresh reads
  useEffect(() => {
    if (providerId !== 'opencode-v2' || !available) return
    let active = true
    const options = { container: JSON.parse(sourceKey) }
    void (async () => {
      try {
        const providers = await providerApi.getConnections(providerId, options)
        if (!active) return
        setResult({ scope, providers })
        if (!openCodeConnectionsNeedCheck(providers)) return
        const checked = await providerApi.getConnections(providerId, {
          ...options,
          forceRefresh: true
        })
        if (active) setResult({ scope, providers: checked })
      } catch (error) {
        // An unavailable check does not establish that the selected credential is bad.
        console.error('[useOpenCodeConnectionHealth]', error)
      }
    })()
    return () => {
      active = false
    }
  }, [providerId, available, sourceKey, scope, model, chatKey, revision])

  return providerId === 'opencode-v2' && available && result?.scope === scope
    ? getOpenCodeConnectionFailure(result.providers, model)
    : null
}
