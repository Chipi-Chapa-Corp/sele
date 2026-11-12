import { appApi } from '../../appApi'
import { getContainerTargetKey } from '../../containerSelection'
import { useProviderUpdates } from '../../useProviderUpdates'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

type WorkspaceProviderUpdatesDependencies = {
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  provider: ReturnType<typeof useWorkspaceProviderContext>
}

export function useWorkspaceProviderUpdates({
  sourceState,
  providerState,
  provider
}: WorkspaceProviderUpdatesDependencies) {
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
