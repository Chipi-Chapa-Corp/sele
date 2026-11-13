import { appApi } from '../../appApi'
import { getContainerTargetKey } from '../../containerSelection'
import { useProviderUpdates } from '../../useProviderUpdates'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import type { WorkspaceState } from '../composition/useWorkspaceState'

export function useWorkspaceProviderUpdates({
  sourceState,
  providerState,
  provider
}: WorkspaceState & {
  provider: ReturnType<typeof useWorkspaceProviderContext>
}) {
  const updates = useProviderUpdates({
    providerIds: sourceState.newSessionAvailableProviderIds,
    container: sourceState.newSessionContainer,
    onUpdated: async (_result, container) => {
      providerState.setProviderModelsRevision((revision) => revision + 1)
      const sourceKey = getContainerTargetKey(container)
      if (sourceKey !== sourceState.newSessionContainerKeyRef.current) return
      const availability = await appApi.getSourceAvailability({ container })
      if (sourceKey !== sourceState.newSessionContainerKeyRef.current) return
      sourceState.setNewSessionSourceAvailability({
        containerKey: sourceKey,
        availability,
        error: null
      })
    }
  })

  return {
    ...updates,
    anyProviderUpdateInProgress: updates.providerUpdateInProgress,
    // Chat operations depend only on the provider and runtime they will use.
    providerUpdateInProgress: updates.isProviderUpdating(
      provider.configProviderId,
      provider.configProviderContainer
    )
  }
}
