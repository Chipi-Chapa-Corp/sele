import { startTransition, useEffect, useLayoutEffect, useMemo } from 'react'
import {
  getAccountModelPreferenceKey,
  writeAccountModelPreferences
} from '../../accountModelPreferences'
import { normalizeContainerTarget } from '../../containerSelection'
import {
  resolveProviderModelCatalogFailure,
  resolveProviderModelCatalogSuccess
} from '../../modelCatalogLoad'
import { reconcileModelSelection, reconcileReasoningSelection } from '../../modelSelection'
import { providerApi } from '../../providerApi'
import { getFallbackModels } from '../../providerSettings'
import { getErrorMessage, modelSupportsServiceTier } from '../chatControllerUtils'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useWorkspaceProviderContext } from './useWorkspaceProviderContext'

type WorkspaceModelCatalogsDependencies = {
  provider: ReturnType<typeof useWorkspaceProviderContext>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  chatState: ReturnType<typeof useWorkspaceChatState>
  preferences: ReturnType<typeof useWorkspacePreferenceState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
}

export function useWorkspaceModelCatalogs({
  provider,
  providerState,
  chatState,
  preferences,
  sourceState
}: WorkspaceModelCatalogsDependencies) {
  useEffect(() => {
    let active = true
    const fallbackModels = getFallbackModels(provider.configProviderId)
    const cachedModels = providerState.providerModelCatalogCacheRef.current.get(
      provider.configProviderModelCatalogKey
    )
    // Catalog refreshes change composer metadata, not the selected transcript.
    // Keep their renders out of the urgent cached-chat reveal.
    const publishCatalog = (publish: () => void): void => startTransition(publish)

    if (!provider.configProviderModelsReady) {
      queueMicrotask(() =>
        publishCatalog(() => {
          if (!active) return
          if (cachedModels) {
            providerState.setModels(cachedModels)
            providerState.setDisplayedModelCatalogKey(provider.configProviderModelCatalogKey)
          } else {
            providerState.setDisplayedModelCatalogKey((currentKey) => {
              if (currentKey === provider.configProviderModelCatalogKey) return currentKey
              providerState.setModels([])
              return null
            })
          }
          providerState.setModelsError(null)
          providerState.setModelsLoading(false)
        })
      )

      return () => {
        active = false
      }
    }

    const container = normalizeContainerTarget(provider.configProviderContainerRef.current)
    queueMicrotask(() =>
      publishCatalog(() => {
        if (!active) return
        if (cachedModels) {
          providerState.setModels(cachedModels)
          providerState.setModelsLoading(false)
          providerState.setDisplayedModelCatalogKey(provider.configProviderModelCatalogKey)
        } else {
          providerState.setModels(provider.configProviderId === 'claude' ? [] : fallbackModels)
          providerState.setModelsLoading(true)
          providerState.setDisplayedModelCatalogKey(null)
        }
        providerState.setModelsError(null)
      })
    )

    Promise.all([
      providerApi.getModels(provider.configProviderId, {
        container,
        chatId: chatState.selectedChat?.id
      }),
      providerApi
        .getAccounts(provider.configProviderId, { container, chatId: chatState.selectedChat?.id })
        .catch((error: unknown) => {
          console.error('Unable to identify the account for model preferences.', error)
          return null
        })
    ])
      .then(([nextModels, configuration]) => {
        if (!active) return

        publishCatalog(() => {
          const result = resolveProviderModelCatalogSuccess(nextModels, fallbackModels)
          const accountId = configuration?.accounts.find((account) => account.active)?.id
          providerState.setModelCatalogIdentity(
            nextModels.length > 0
              ? {
                  key: provider.configProviderModelCatalogKey,
                  revision: providerState.providerModelsRevision,
                  accountKey: accountId
                    ? getAccountModelPreferenceKey(
                        provider.configProviderId,
                        provider.configProviderContainerKey,
                        accountId
                      )
                    : null
                }
              : null
          )
          providerState.providerModelCatalogCacheRef.current.set(
            provider.configProviderModelCatalogKey,
            result.models
          )
          providerState.setDisplayedModelCatalogKey(provider.configProviderModelCatalogKey)
          providerState.setModels(result.models)
          providerState.setModelsError(result.error)
          providerState.setModelsLoading(false)
        })
      })
      .catch((error: unknown) => {
        console.error('Unable to load provider models.', error)
        if (!active) return
        publishCatalog(() => {
          const result = resolveProviderModelCatalogFailure(
            cachedModels,
            fallbackModels,
            getErrorMessage(error, 'Unable to load models.')
          )
          providerState.setDisplayedModelCatalogKey(provider.configProviderModelCatalogKey)
          providerState.setModels(result.models)
          providerState.setModelsError(result.error)
          providerState.setModelsLoading(false)
        })
      })

    return () => {
      active = false
    }
  }, [
    provider.configProviderContainerKey,
    provider.configProviderId,
    provider.configProviderModelCatalogKey,
    provider.configProviderModelsReady,
    providerState.providerModelsRevision,
    chatState.selectedChat?.id
  ])

  useEffect(() => {
    if (
      !preferences.settingsOpen ||
      preferences.settingsTab !== 'git' ||
      provider.gitSettingsUsesConfigProviderModels
    )
      return

    let active = true
    const fallbackModels = getFallbackModels(sourceState.newSessionProvider)
    const cachedModels = providerState.providerModelCatalogCacheRef.current.get(
      provider.gitSettingsModelCatalogKey
    )

    if (!provider.gitSettingsModelsReady) {
      queueMicrotask(() => {
        if (!active) return
        providerState.setGitSettingsModels(cachedModels ?? [])
        providerState.setGitSettingsModelsLoading(false)
        providerState.setDisplayedGitSettingsModelCatalogKey(
          cachedModels ? provider.gitSettingsModelCatalogKey : null
        )
      })

      return () => {
        active = false
      }
    }

    const container = normalizeContainerTarget(sourceState.newSessionContainer)
    queueMicrotask(() => {
      if (!active) return
      if (cachedModels) {
        providerState.setGitSettingsModels(cachedModels)
        providerState.setGitSettingsModelsLoading(false)
        providerState.setDisplayedGitSettingsModelCatalogKey(provider.gitSettingsModelCatalogKey)
      } else {
        providerState.setGitSettingsModels(
          sourceState.newSessionProvider === 'claude' ? [] : fallbackModels
        )
        providerState.setGitSettingsModelsLoading(true)
        providerState.setDisplayedGitSettingsModelCatalogKey(provider.gitSettingsModelCatalogKey)
      }
    })

    providerApi
      .getModels(sourceState.newSessionProvider, { container })
      .then((nextModels) => {
        if (!active) return

        const resolvedModels = nextModels.length > 0 ? nextModels : fallbackModels
        providerState.providerModelCatalogCacheRef.current.set(
          provider.gitSettingsModelCatalogKey,
          resolvedModels
        )
        providerState.setDisplayedGitSettingsModelCatalogKey(provider.gitSettingsModelCatalogKey)
        providerState.setGitSettingsModels(resolvedModels)
        providerState.setGitSettingsModelsLoading(false)
      })
      .catch((error: unknown) => {
        console.error('Unable to load models for Git settings.', error)
        if (!active) return
        const resolvedModels = cachedModels ?? fallbackModels
        providerState.providerModelCatalogCacheRef.current.set(
          provider.gitSettingsModelCatalogKey,
          resolvedModels
        )
        providerState.setDisplayedGitSettingsModelCatalogKey(provider.gitSettingsModelCatalogKey)
        providerState.setGitSettingsModels(resolvedModels)
        providerState.setGitSettingsModelsLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    provider.gitSettingsModelCatalogKey,
    provider.gitSettingsModelsReady,
    provider.gitSettingsUsesConfigProviderModels,
    sourceState.newSessionContainer,
    sourceState.newSessionProvider,
    providerState.providerModelsRevision,
    preferences.settingsOpen,
    preferences.settingsTab
  ])

  const activeModelCatalog = useMemo(
    () => ({
      activeKey: provider.configProviderModelCatalogKey,
      displayedKey: providerState.displayedModelCatalogKey,
      loading:
        providerState.modelsLoading ||
        !provider.configProviderModelsReady ||
        providerState.modelCatalogIdentity?.key !== provider.configProviderModelCatalogKey ||
        providerState.modelCatalogIdentity.revision !== providerState.providerModelsRevision,
      error: providerState.modelsError
    }),
    [
      provider.configProviderModelCatalogKey,
      providerState.displayedModelCatalogKey,
      providerState.modelsLoading,
      provider.configProviderModelsReady,
      providerState.modelCatalogIdentity,
      providerState.providerModelsRevision,
      providerState.modelsError
    ]
  )

  const modelAccountKey =
    provider.configProviderId === 'opencode-v2'
      ? getAccountModelPreferenceKey(
          provider.configProviderId,
          provider.configProviderContainerKey,
          provider.openCodeProviders.selectedId
        )
      : (providerState.modelCatalogIdentity?.accountKey ?? null)

  useLayoutEffect(() => {
    const selection = reconcileModelSelection(
      provider.models,
      {
        model: providerState.model,
        manuallySelected: providerState.modelManuallySelectedRef.current
      },
      activeModelCatalog,
      modelAccountKey
        ? providerState.accountModelPreferencesRef.current[modelAccountKey]
        : undefined
    )
    providerState.modelManuallySelectedRef.current = selection.manuallySelected
    if (selection.model !== providerState.model) providerState.setModel(selection.model)
    if (
      modelAccountKey &&
      !activeModelCatalog.loading &&
      !activeModelCatalog.error &&
      activeModelCatalog.displayedKey === activeModelCatalog.activeKey &&
      provider.models.some((candidate) => candidate.id === selection.model) &&
      providerState.accountModelPreferencesRef.current[modelAccountKey] !== selection.model
    ) {
      providerState.accountModelPreferencesRef.current[modelAccountKey] = selection.model
      writeAccountModelPreferences(providerState.accountModelPreferencesRef.current)
    }
  }, [activeModelCatalog, modelAccountKey, providerState.model, provider.models])

  useEffect(() => {
    const selectedModel = provider.models.find((nextModel) => nextModel.id === providerState.model)
    const catalog = activeModelCatalog

    const selection = reconcileReasoningSelection(
      selectedModel,
      {
        reasoningEffort: providerState.reasoningEffort,
        manuallySelected: providerState.reasoningManuallySelectedRef.current
      },
      catalog
    )
    providerState.reasoningManuallySelectedRef.current = selection.manuallySelected
    if (selection.reasoningEffort !== providerState.reasoningEffort)
      providerState.setReasoningEffort(selection.reasoningEffort)

    if (
      catalog.loading ||
      catalog.error ||
      catalog.displayedKey !== catalog.activeKey ||
      !selectedModel
    )
      return
    const nextServiceTier = modelSupportsServiceTier(selectedModel, providerState.serviceTier)
      ? providerState.serviceTier
      : (selectedModel.defaultServiceTier ?? null)
    if (nextServiceTier !== providerState.serviceTier) providerState.setServiceTier(nextServiceTier)
  }, [
    providerState.model,
    provider.models,
    activeModelCatalog,
    providerState.reasoningEffort,
    providerState.serviceTier
  ])
  return { activeModelCatalog, modelAccountKey }
}
