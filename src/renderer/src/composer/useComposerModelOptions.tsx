import { Gauge, Zap } from 'lucide-react'
import { useMemo } from 'react'
import type { ProviderModelId, ProviderReasoningEffort } from '../../../shared/provider'
import { type DropdownOption } from '../components/Dropdown'
import { ProviderIcon } from '../components/ProviderIcon'
import { getReasoningEffortPresentation } from '../reasoningEffortPresentation'
import {
  fastServiceTierIconClassName,
  formatModelLabel,
  getModelMenuLabel,
  getReasoningEffortOptionLabel,
  isFastServiceTier,
  standardServiceTierValue
} from './configPresentation'

type ComposerModelOptionsDependencies = {
  models: import('../../../shared/provider').ProviderModel[]
  model: string
  modelsUnavailable: boolean
  modelsLoading: boolean
  providerId: 'codex' | 'claude' | 'copilot' | 'opencode-v2'
  serviceTier: string | null
  reasoningEffort: string
}

export function useComposerModelOptions({
  models,
  model,
  modelsUnavailable,
  modelsLoading,
  providerId,
  serviceTier,
  reasoningEffort
}: ComposerModelOptionsDependencies) {
  const selectedModel = models.find((candidateModel) => candidateModel.id === model)

  const modelSelectionUnavailable = modelsUnavailable || modelsLoading || models.length === 0

  const unavailableModelLabel =
    modelsLoading && !modelsUnavailable ? 'Loading models…' : 'No models'

  // Typing changes the draft, not the model catalog. Keep this work out of the
  // synchronous input render, especially for OpenCode's large model lists.
  const modelOptions = useMemo(
    () =>
      modelSelectionUnavailable
        ? []
        : models.map(
            (candidateModel): DropdownOption<ProviderModelId> => ({
              value: candidateModel.id,
              label: formatModelLabel(candidateModel.label),
              menuLabel: getModelMenuLabel(
                formatModelLabel(candidateModel.label),
                candidateModel.isDefault
              ),
              description: candidateModel.description || undefined,
              icon: <ProviderIcon providerId={providerId} aria-hidden="true" />
            })
          ),
    [modelSelectionUnavailable, models, providerId]
  )

  const displayedModelOptions = modelSelectionUnavailable
    ? [
        {
          value: model,
          label: unavailableModelLabel,
          icon: <ProviderIcon providerId={providerId} aria-hidden="true" />,
          disabled: true
        }
      ]
    : modelOptions.some((option) => option.value === model)
      ? modelOptions
      : [
          ...modelOptions,
          {
            value: model,
            label: formatModelLabel(model),
            icon: <ProviderIcon providerId={providerId} aria-hidden="true" />
          }
        ]

  const supportedServiceTiers = selectedModel?.supportedServiceTiers ?? []

  const serviceTierSelectionAvailable = supportedServiceTiers.length > 0

  const serviceTierOptions: DropdownOption<string>[] = [
    {
      value: standardServiceTierValue,
      label: 'Standard',
      description: 'Standard response speed and credit usage',
      icon: <Gauge aria-hidden="true" />
    },
    ...supportedServiceTiers.map((option) => ({
      value: option.id,
      label: option.label,
      menuLabel: option.isDefault ? `${option.label} (default)` : option.label,
      description: option.description || undefined,
      icon: isFastServiceTier(option.id, option.label) ? (
        <Zap className={fastServiceTierIconClassName} aria-hidden="true" />
      ) : (
        <Gauge aria-hidden="true" />
      )
    }))
  ]

  const displayedServiceTierOptions = serviceTierOptions

  const selectedServiceTier = serviceTier == null ? null : serviceTier

  const selectedServiceTierOption = displayedServiceTierOptions.find(
    (option) => option.value === (selectedServiceTier ?? standardServiceTierValue)
  )

  const supportedReasoningEfforts = selectedModel?.supportedReasoningEfforts ?? []

  const reasoningSelectionAvailable = supportedReasoningEfforts.length > 0

  const reasoningEffortOptions = supportedReasoningEfforts.map((option) => {
    const presentation = getReasoningEffortPresentation(option.id)
    const label = getReasoningEffortOptionLabel(option.id, option.label)

    return {
      value: option.id,
      label,
      menuLabel: option.isDefault ? `${label} (default)` : label,
      description: option.description || undefined,
      icon: presentation.icon
    } satisfies DropdownOption<ProviderReasoningEffort>
  })

  const selectedReasoningEffortPresentation = getReasoningEffortPresentation(reasoningEffort)

  const displayedReasoningEffortOptions = reasoningEffortOptions

  const selectedReasoningEffortLabel = selectedReasoningEffortPresentation.label

  const selectedServiceTierValue = selectedServiceTier ?? standardServiceTierValue

  const selectedModelLabel = modelSelectionUnavailable
    ? unavailableModelLabel
    : formatModelLabel(selectedModel?.label ?? model)

  const selectedServiceTierLabel = selectedServiceTierOption?.label ?? 'Standard'
  return {
    modelSelectionUnavailable,
    displayedModelOptions,
    serviceTierSelectionAvailable,
    displayedServiceTierOptions,
    selectedServiceTier,
    selectedServiceTierOption,
    reasoningSelectionAvailable,
    selectedReasoningEffortPresentation,
    displayedReasoningEffortOptions,
    selectedReasoningEffortLabel,
    selectedServiceTierValue,
    selectedModelLabel,
    selectedServiceTierLabel
  }
}
