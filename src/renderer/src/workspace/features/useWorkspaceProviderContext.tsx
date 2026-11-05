import { useEffect, useMemo, useRef } from 'react'
import { getContainerTargetKey, normalizeContainerTarget } from '../../containerSelection'
import { filterOpenCodeModels } from '../../openCodeProviderPreferences'
import { useOpenCodeProviders } from '../../useOpenCodeProviders'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

type WorkspaceProviderContextDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  providerState: ReturnType<typeof useWorkspaceProviderState>
}

export function useWorkspaceProviderContext({
  chatState,
  sourceState,
  providerState
}: WorkspaceProviderContextDependencies) {
  const configProviderId = chatState.selectedChat?.providerId ?? sourceState.newSessionProvider

  const configProviderHasSelectedChat = Boolean(chatState.selectedChat)

  const configProviderContainer = chatState.selectedChat
    ? chatState.selectedChat.container
    : sourceState.newSessionContainer

  const configProviderContainerKey = getContainerTargetKey(configProviderContainer)

  const configProviderModelCatalogKey = `${configProviderId}:${configProviderContainerKey}${chatState.selectedChat ? `:${chatState.selectedChat.accountId ?? chatState.selectedChat.id}` : ''}`

  const configProviderContainerRef = useRef(configProviderContainer)

  useEffect(() => {
    configProviderContainerRef.current = configProviderContainer
  }, [configProviderContainer, configProviderContainerKey])

  const configProviderModelsReady =
    configProviderHasSelectedChat ||
    (sourceState.newSessionSourceAvailabilityReady &&
      sourceState.newSessionProviderAvailable &&
      chatState.loadState !== 'loading')

  const openCodeProviders = useOpenCodeProviders({
    providerId: configProviderId,
    enabled: configProviderId === 'opencode-v2' && configProviderModelsReady,
    container: normalizeContainerTarget(configProviderContainer),
    models:
      providerState.displayedModelCatalogKey === configProviderModelCatalogKey
        ? providerState.allModels
        : [],
    model: providerState.model,
    revision: providerState.providerModelsRevision
  })

  const models = useMemo(
    () =>
      configProviderId === 'opencode-v2'
        ? providerState.displayedModelCatalogKey === configProviderModelCatalogKey
          ? filterOpenCodeModels(providerState.allModels, openCodeProviders.selectedId)
          : []
        : providerState.allModels,
    [
      providerState.allModels,
      configProviderId,
      openCodeProviders.selectedId,
      providerState.displayedModelCatalogKey,
      configProviderModelCatalogKey
    ]
  )

  const gitSettingsModelCatalogKey = `${sourceState.newSessionProvider}:${sourceState.newSessionContainerKey}`

  const gitSettingsUsesConfigProviderModels =
    gitSettingsModelCatalogKey === configProviderModelCatalogKey

  const gitSettingsModelsReady =
    sourceState.newSessionSourceAvailabilityReady &&
    sourceState.newSessionProviderAvailable &&
    chatState.loadState !== 'loading'
  return {
    configProviderId,
    configProviderContainer,
    configProviderContainerKey,
    configProviderModelCatalogKey,
    configProviderContainerRef,
    configProviderModelsReady,
    openCodeProviders,
    models,
    gitSettingsModelCatalogKey,
    gitSettingsUsesConfigProviderModels,
    gitSettingsModelsReady
  }
}
