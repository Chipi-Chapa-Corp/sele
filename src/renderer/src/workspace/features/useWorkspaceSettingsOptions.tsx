import { Bot, MessageSquare } from 'lucide-react'
import { useMemo } from 'react'
import type { DropdownOption } from '../../components/Dropdown'
import {
  approvalModeIcons,
  formatModelLabel,
  formatOptionLabel,
  sandboxModeIcons
} from '../../composer/configPresentation'
import { getChatServiceTierIcon } from '../../messageBoxPreferences'
import { getReasoningEffortPresentation } from '../../reasoningEffortPresentation'
import {
  appChatManualDropdownValue,
  appChatStandardSpeedValue,
  type AppChatDropdownSettings
} from '../../settings'
import { getDefaultModel, modelHasServiceTierOptions } from '../appearanceControllerUtils'
import type { WorkspaceSession } from '../useWorkspaceSelection'

export function useWorkspaceSettingsOptions({
  settings,
  providerState,
  provider
}: WorkspaceSession) {
  const settingsConfiguredModel =
    settings.settingsPanelSettings.chat.forceModel === appChatManualDropdownValue
      ? providerState.model
      : settings.settingsPanelSettings.chat.forceModel

  const settingsEffectiveModel = provider.models.some(
    (candidateModel) => candidateModel.id === settingsConfiguredModel
  )
    ? settingsConfiguredModel
    : getDefaultModel(provider.models).id

  const settingsSelectedEffectiveModel = provider.models.find(
    (candidateModel) => candidateModel.id === settingsEffectiveModel
  )

  // Model catalogs vary by provider, account, and refresh state. Never rewrite
  // stored forced-model/reasoning/speed preferences to match a transient catalog.
  const forceAccessOptions: DropdownOption<AppChatDropdownSettings['forceAccess']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the access selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...providerState.sandboxModes.map((mode) => ({
      value: mode.id,
      label: mode.label,
      description: mode.description || undefined,
      icon: sandboxModeIcons[mode.id]
    }))
  ]

  const forceReviewOptions: DropdownOption<AppChatDropdownSettings['forceReview']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the review mode selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...providerState.approvalModes.map((mode) => ({
      value: mode.id,
      label: mode.label,
      description: mode.description || undefined,
      icon: approvalModeIcons[mode.id]
    }))
  ]

  // Catalogs can contain hundreds of models. Streaming renders must not rebuild
  // their JSX (including development stack traces) for a closed settings dialog.
  const forceModelOptions = useMemo<DropdownOption<AppChatDropdownSettings['forceModel']>[]>(
    () => [
      {
        value: appChatManualDropdownValue,
        label: 'Manual',
        description: 'Use the model selected manually in the chat.',
        icon: <MessageSquare aria-hidden="true" />
      },
      ...provider.models.map((candidateModel) => ({
        value: candidateModel.id,
        label: formatModelLabel(candidateModel.label),
        description: candidateModel.description || undefined,
        icon: <Bot aria-hidden="true" />
      }))
    ],
    [provider.models]
  )

  const forceReasoningOptions: DropdownOption<AppChatDropdownSettings['forceReasoning']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the reasoning effort selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...(settingsSelectedEffectiveModel?.supportedReasoningEfforts ?? []).map((option) => {
      const presentation = getReasoningEffortPresentation(option.id)

      return {
        value: option.id,
        label: presentation.isKnown
          ? presentation.label
          : formatOptionLabel(option.label || option.id),
        description: option.description || undefined,
        icon: presentation.icon
      }
    })
  ]

  const forceSpeedOptions: DropdownOption<AppChatDropdownSettings['forceSpeed']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the speed selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...(modelHasServiceTierOptions(settingsSelectedEffectiveModel)
      ? [
          {
            value: appChatStandardSpeedValue,
            label: 'Standard',
            description: 'Standard response speed and credit usage',
            icon: getChatServiceTierIcon(appChatStandardSpeedValue)
          } satisfies DropdownOption<AppChatDropdownSettings['forceSpeed']>
        ]
      : []),
    ...(settingsSelectedEffectiveModel?.supportedServiceTiers ?? []).map((option) => ({
      value: option.id,
      label: option.label,
      description: option.description || undefined,
      icon: getChatServiceTierIcon(option.id, option.label)
    }))
  ]
  return {
    forceAccessOptions,
    forceReviewOptions,
    forceModelOptions,
    forceReasoningOptions,
    forceSpeedOptions
  }
}
