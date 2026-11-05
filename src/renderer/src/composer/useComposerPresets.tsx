import { Rocket, Zap } from 'lucide-react'
import type { ProviderAgentMode, ProviderSandboxMode } from '../../../shared/provider'
import { selectionsEqual } from '../chatModelPreferences'
import { getChatPresetChanges } from '../chatPresets'
import { type ChatConfigPresetDetails } from '../components/ChatConfigDropdown'
import type { MessageBoxSelection } from '../messageBoxPreferences'
import { getReasoningEffortPresentation } from '../reasoningEffortPresentation'
import {
  fastServiceTierIconClassName,
  formatModelLabel,
  formatOptionLabel,
  isFastServiceTier,
  sandboxModeIcons
} from './configPresentation'
import { useComposerAccessOptions } from './useComposerAccessOptions'
import { useComposerModelOptions } from './useComposerModelOptions'

type ComposerPresetsDependencies = {
  agentMode: ProviderAgentMode
  accessConfig: ReturnType<typeof useComposerAccessOptions>
  model: string
  reasoningEffort: string
  sandboxMode: ProviderSandboxMode
  serviceTier: string | null
  showModelSelector: boolean
  showReasoningSelector: boolean
  showAccessSelector: boolean
  showReviewSelector: boolean
  questionsSelectorVisible: boolean
  agentModesLoading: boolean
  showSpeedSelector: boolean
  models: import('../../../shared/provider').ProviderModel[]
  agentModes: import('../../../shared/provider').ProviderAgentModeOption[]
  providerUpdating: boolean
  modelConfig: ReturnType<typeof useComposerModelOptions>
}

export function useComposerPresets({
  agentMode,
  accessConfig,
  model,
  reasoningEffort,
  sandboxMode,
  serviceTier,
  showModelSelector,
  showReasoningSelector,
  showAccessSelector,
  showReviewSelector,
  questionsSelectorVisible,
  agentModesLoading,
  showSpeedSelector,
  models,
  agentModes,
  providerUpdating,
  modelConfig
}: ComposerPresetsDependencies) {
  const currentPresetSelection: MessageBoxSelection = {
    agentMode,
    approvalMode: accessConfig.effectiveApprovalMode,
    model,
    reasoningEffort,
    sandboxMode,
    serviceTier
  }

  const presetEditableFields = {
    model: showModelSelector,
    reasoningEffort: showReasoningSelector,
    sandboxMode: showAccessSelector,
    approvalMode: showReviewSelector,
    agentMode: questionsSelectorVisible && !agentModesLoading,
    serviceTier: showSpeedSelector
  }

  const resolvePreset = (preset: MessageBoxSelection): MessageBoxSelection => {
    const resolved = {
      ...currentPresetSelection,
      ...getChatPresetChanges(preset, presetEditableFields)
    }
    if (resolved.sandboxMode === 'danger-full-access') resolved.approvalMode = 'never'
    return resolved
  }

  const getPresetDetails = (preset: MessageBoxSelection): ChatConfigPresetDetails => {
    const resolved = resolvePreset(preset)
    const presetModel = models.find((candidate) => candidate.id === resolved.model)
    const reasoning = getReasoningEffortPresentation(resolved.reasoningEffort)
    const hasReasoning = Boolean(presetModel?.supportedReasoningEfforts.length)
    const tier = presetModel?.supportedServiceTiers?.find(
      (option) => option.id === resolved.serviceTier
    )
    const fast =
      resolved.serviceTier != null && isFastServiceTier(resolved.serviceTier, tier?.label ?? '')
    const mode = agentModes.find((option) => option.id === resolved.agentMode)
    const access = accessConfig.sandboxModeOptions.find(
      (option) => option.value === resolved.sandboxMode
    )
    const review = accessConfig.approvalModeOptions.find(
      (option) => option.value === resolved.approvalMode
    )
    const modelLabel = formatModelLabel(presetModel?.label ?? resolved.model)
    const reasoningLabel = hasReasoning ? reasoning.label : null
    const speedLabel =
      resolved.serviceTier == null ? null : (tier?.label ?? formatOptionLabel(resolved.serviceTier))
    const disabled =
      providerUpdating ||
      modelConfig.modelSelectionUnavailable ||
      !presetModel ||
      (hasReasoning &&
        !presetModel.supportedReasoningEfforts.some(
          (option) => option.id === resolved.reasoningEffort
        )) ||
      (resolved.serviceTier != null && !tier) ||
      (showAccessSelector && !access) ||
      (showReviewSelector && resolved.sandboxMode !== 'danger-full-access' && !review) ||
      (presetEditableFields.agentMode && !mode)
    return {
      modelLabel,
      reasoningLabel,
      speedLabel,
      disabled,
      selected: selectionsEqual(resolved, currentPresetSelection),
      title: [
        `Model: ${modelLabel}`,
        hasReasoning ? `Reasoning: ${reasoning.label}` : null,
        `Access: ${access?.label ?? formatOptionLabel(resolved.sandboxMode)}`,
        `Review: ${review?.label ?? formatOptionLabel(resolved.approvalMode)}`,
        questionsSelectorVisible ? `Questions: ${mode?.label ?? resolved.agentMode}` : null,
        `Speed: ${speedLabel ?? 'Standard'}`,
        disabled ? 'Unavailable with the current provider or settings' : null
      ]
        .filter(Boolean)
        .join(' · '),
      statusIcons: [
        ...(resolved.sandboxMode === 'danger-full-access'
          ? [
              {
                key: 'full-access',
                title: 'Full access',
                icon: sandboxModeIcons[resolved.sandboxMode]
              }
            ]
          : []),
        ...(hasReasoning && reasoning.showStatusIcon
          ? [{ key: 'reasoning', title: `${reasoning.label} reasoning`, icon: reasoning.icon }]
          : []),
        ...(fast
          ? [
              {
                key: 'speed',
                title: `${speedLabel} speed`,
                icon: <Zap className={fastServiceTierIconClassName} aria-hidden="true" />
              }
            ]
          : []),
        ...(questionsSelectorVisible && resolved.agentMode === 'autopilot'
          ? [{ key: 'autopilot', title: 'Autopilot', icon: <Rocket aria-hidden="true" /> }]
          : [])
      ]
    }
  }
  return { currentPresetSelection, presetEditableFields, getPresetDetails }
}
