import { Bot, MessageSquare } from 'lucide-react'
import { useMemo } from 'react'
import type { DropdownOption } from '../../components/Dropdown'
import { getAppGitCommitModel } from '../../gitCommitModels'
import { formatModelLabel } from '../../composer/configPresentation'
import { gitCurrentChatModelValue } from '../controllerTypes'
import type { WorkspaceSession } from '../useWorkspaceSelection'

export function useWorkspaceGitModels({
  provider,
  providerState,
  settings,
  sourceState
}: WorkspaceSession) {
  const gitSettingsModelsCurrent = provider.gitSettingsUsesConfigProviderModels
    ? providerState.displayedModelCatalogKey === provider.gitSettingsModelCatalogKey
    : providerState.displayedGitSettingsModelCatalogKey === provider.gitSettingsModelCatalogKey

  const gitSettingsModelCatalog = provider.gitSettingsUsesConfigProviderModels
    ? provider.models
    : providerState.gitSettingsModels

  const gitSettingsModelCatalogLoading = provider.gitSettingsUsesConfigProviderModels
    ? providerState.modelsLoading
    : providerState.gitSettingsModelsLoading

  const displayedGitSettingsModels = useMemo(
    () => (gitSettingsModelsCurrent ? gitSettingsModelCatalog : []),
    [gitSettingsModelCatalog, gitSettingsModelsCurrent]
  )

  const savedGitCommitModel = getAppGitCommitModel(
    settings.settingsPanelSettings.git.commitModels,
    sourceState.newSessionProvider,
    sourceState.newSessionContainerKey
  )

  const savedGitCommitModelOption = savedGitCommitModel
    ? displayedGitSettingsModels.find((candidateModel) => candidateModel.id === savedGitCommitModel)
    : undefined

  const gitCommitModelValue = savedGitCommitModel ?? gitCurrentChatModelValue

  const gitCommitModelOptions = useMemo<DropdownOption<string>[]>(() => {
    const modelOptions = displayedGitSettingsModels.map(
      (candidateModel): DropdownOption<string> => ({
        value: candidateModel.id,
        label: formatModelLabel(candidateModel.label),
        menuLabel: candidateModel.isDefault
          ? `${formatModelLabel(candidateModel.label)} (default)`
          : formatModelLabel(candidateModel.label),
        description: candidateModel.description || undefined,
        icon: <Bot aria-hidden="true" />
      })
    )
    const unavailableSavedModelOption =
      savedGitCommitModel && !savedGitCommitModelOption
        ? [
            {
              value: savedGitCommitModel,
              label: formatModelLabel(savedGitCommitModel),
              description: 'This configured model is not available in the selected environment.',
              icon: <Bot aria-hidden="true" />
            }
          ]
        : []

    return [
      {
        value: gitCurrentChatModelValue,
        label: 'Selected model',
        description: 'Use the model selected in the chat at the moment you commit.',
        icon: <MessageSquare aria-hidden="true" />
      },
      ...unavailableSavedModelOption,
      ...modelOptions
    ]
  }, [displayedGitSettingsModels, savedGitCommitModel, savedGitCommitModelOption])
  return {
    gitSettingsModelsCurrent,
    gitSettingsModelCatalogLoading,
    gitCommitModelValue,
    gitCommitModelOptions
  }
}
