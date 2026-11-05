import { Gauge, MessageCircleQuestion, Rocket, Sparkles, Zap } from 'lucide-react'
import type {
  ProviderAgentMode,
  ProviderApprovalMode,
  ProviderModelId,
  ProviderReasoningEffort,
  ProviderSandboxMode
} from '../../../shared/provider'
import {
  type ChatConfigOptionGroup,
  type ChatConfigSection,
  type SelectorIconItem
} from '../components/ChatConfigDropdown'
import { type DropdownOption } from '../components/Dropdown'
import { ProviderIcon } from '../components/ProviderIcon'
import {
  approvalModeIcons,
  fastServiceTierIconClassName,
  formatOptionLabel,
  isFastServiceTier,
  sandboxModeIcons,
  standardServiceTierValue
} from './configPresentation'
import { useComposerAccessOptions } from './useComposerAccessOptions'
import { useComposerModelOptions } from './useComposerModelOptions'

type ComposerConfigSectionsDependencies = {
  providerId: 'codex' | 'claude' | 'copilot' | 'opencode-v2'
  agentModesLoading: boolean
  agentModes: import('../../../shared/provider').ProviderAgentModeOption[]
  agentMode: ProviderAgentMode
  showModelSelector: boolean
  providerUpdating: boolean
  modelConfig: ReturnType<typeof useComposerModelOptions>
  model: string
  onModelChange: (model: ProviderModelId) => void
  showReasoningSelector: boolean
  reasoningEffort: string
  onReasoningEffortChange: (reasoningEffort: ProviderReasoningEffort) => void
  onAgentModeChange: (agentMode: ProviderAgentMode) => void
  showAccessSelector: boolean
  accessConfig: ReturnType<typeof useComposerAccessOptions>
  sandboxMode: ProviderSandboxMode
  onSandboxModeChange: (sandboxMode: ProviderSandboxMode) => void
  onApprovalModeChange: (approvalMode: ProviderApprovalMode) => void
  showSpeedSelector: boolean
  onServiceTierChange: (
    serviceTier: import('../../../shared/provider').ProviderServiceTier | null
  ) => void
}

export function useComposerConfigSections({
  providerId,
  agentModesLoading,
  agentModes,
  agentMode,
  showModelSelector,
  providerUpdating,
  modelConfig,
  model,
  onModelChange,
  showReasoningSelector,
  reasoningEffort,
  onReasoningEffortChange,
  onAgentModeChange,
  showAccessSelector,
  accessConfig,
  sandboxMode,
  onSandboxModeChange,
  onApprovalModeChange,
  showSpeedSelector,
  onServiceTierChange
}: ComposerConfigSectionsDependencies) {
  const questionsSelectorVisible =
    providerId === 'copilot' && (agentModesLoading || agentModes.length > 0)

  const selectedAgentMode = agentModes.find((mode) => mode.id === agentMode)

  const questionModeOptions: DropdownOption<ProviderAgentMode>[] = agentModes.map((mode) => ({
    value: mode.id,
    label: mode.label,
    menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
    description: mode.description,
    icon:
      mode.id === 'autopilot' ? (
        <Rocket aria-hidden="true" />
      ) : (
        <MessageCircleQuestion aria-hidden="true" />
      )
  }))

  const chatConfigSections: ChatConfigSection[] = [
    ...(showModelSelector
      ? [
          {
            id: 'model',
            disabled: providerUpdating,
            icon: <ProviderIcon providerId={providerId} aria-hidden="true" />,
            label: modelConfig.modelSelectionUnavailable ? 'Model' : modelConfig.selectedModelLabel,
            groups: [
              {
                id: 'model',
                options: modelConfig.displayedModelOptions.map((option) => ({
                  ...option,
                  disabled:
                    providerUpdating ||
                    modelConfig.modelSelectionUnavailable ||
                    ('disabled' in option ? option.disabled : false)
                })),
                selectedValue: model,
                onChange: (value: string) => onModelChange(value as ProviderModelId)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(showReasoningSelector
      ? [
          {
            id: 'reasoning',
            disabled:
              modelConfig.modelSelectionUnavailable || !modelConfig.reasoningSelectionAvailable,
            icon: modelConfig.reasoningSelectionAvailable ? (
              modelConfig.selectedReasoningEffortPresentation.icon
            ) : (
              <Sparkles />
            ),
            label:
              !modelConfig.modelSelectionUnavailable && modelConfig.reasoningSelectionAvailable
                ? modelConfig.selectedReasoningEffortLabel
                : 'Reasoning',
            groups: [
              {
                id: 'reasoning',
                options: modelConfig.displayedReasoningEffortOptions,
                selectedValue: reasoningEffort,
                onChange: (value: string) =>
                  onReasoningEffortChange(value as ProviderReasoningEffort)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(questionsSelectorVisible
      ? [
          {
            id: 'questions',
            disabled: agentModesLoading || agentModes.length === 0,
            icon:
              agentMode === 'autopilot' ? (
                <Rocket aria-hidden="true" />
              ) : (
                <MessageCircleQuestion aria-hidden="true" />
              ),
            label:
              agentModesLoading || agentModes.length === 0
                ? 'Questions'
                : (selectedAgentMode?.label ?? formatOptionLabel(agentMode)),
            groups: [
              {
                id: 'questions',
                options: questionModeOptions,
                selectedValue: agentMode,
                onChange: (value: string) => onAgentModeChange(value as ProviderAgentMode)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(showAccessSelector || accessConfig.reviewSelectorVisible
      ? [
          {
            id: 'access',
            icon: showAccessSelector
              ? sandboxModeIcons[sandboxMode]
              : approvalModeIcons[accessConfig.effectiveApprovalMode],
            label: showAccessSelector
              ? accessConfig.selectedSandboxModeLabel
              : (accessConfig.selectedApprovalMode?.label ??
                formatOptionLabel(accessConfig.effectiveApprovalMode)),
            groups: [
              ...(showAccessSelector
                ? [
                    {
                      id: 'access',
                      label: accessConfig.reviewSelectorVisible ? 'Access' : undefined,
                      options: accessConfig.displayedSandboxModeOptions,
                      selectedValue: sandboxMode,
                      onChange: (value: string) => onSandboxModeChange(value as ProviderSandboxMode)
                    } satisfies ChatConfigOptionGroup
                  ]
                : []),
              ...(accessConfig.reviewSelectorVisible
                ? [
                    {
                      id: 'review',
                      label: 'Review',
                      options: accessConfig.displayedApprovalModeOptions.map((option) => ({
                        ...option,
                        disabled:
                          accessConfig.approvalSelectorDisabled ||
                          ('disabled' in option ? option.disabled : false)
                      })),
                      selectedValue: accessConfig.effectiveApprovalMode,
                      onChange: (value: string) =>
                        onApprovalModeChange(value as ProviderApprovalMode)
                    } satisfies ChatConfigOptionGroup
                  ]
                : [])
            ]
          } satisfies ChatConfigSection
        ]
      : []),
    ...(showSpeedSelector
      ? [
          {
            id: 'speed',
            disabled:
              modelConfig.modelSelectionUnavailable || !modelConfig.serviceTierSelectionAvailable,
            icon: modelConfig.selectedServiceTierOption?.icon ?? <Gauge aria-hidden="true" />,
            label:
              !modelConfig.modelSelectionUnavailable && modelConfig.serviceTierSelectionAvailable
                ? modelConfig.selectedServiceTierLabel
                : 'Speed',
            groups: [
              {
                id: 'speed',
                options: modelConfig.displayedServiceTierOptions,
                selectedValue: modelConfig.selectedServiceTierValue,
                onChange: (value: string) =>
                  onServiceTierChange(value === standardServiceTierValue ? null : value)
              }
            ]
          } satisfies ChatConfigSection
        ]
      : [])
  ]

  const chatConfigSelectorTitle = [
    `Model: ${modelConfig.selectedModelLabel}`,
    showReasoningSelector &&
    !modelConfig.modelSelectionUnavailable &&
    modelConfig.reasoningSelectionAvailable
      ? `Reasoning: ${modelConfig.selectedReasoningEffortLabel}`
      : null,
    questionsSelectorVisible
      ? `Questions: ${selectedAgentMode?.label ?? formatOptionLabel(agentMode)}`
      : null,
    showAccessSelector ? `Access: ${accessConfig.selectedSandboxModeLabel}` : null,
    accessConfig.reviewSelectorVisible ? `Review: ${accessConfig.selectedApprovalModeTitle}` : null,
    showSpeedSelector && modelConfig.serviceTierSelectionAvailable
      ? `Speed: ${modelConfig.selectedServiceTierLabel}`
      : null
  ]
    .filter(Boolean)
    .join(' · ')

  const fastSpeedSelected =
    modelConfig.selectedServiceTier != null &&
    isFastServiceTier(
      modelConfig.selectedServiceTierValue,
      modelConfig.selectedServiceTierOption?.label ?? ''
    )

  const chatConfigStatusIcons: SelectorIconItem[] = modelConfig.modelSelectionUnavailable
    ? []
    : [
        ...(accessConfig.fullAccessSelected
          ? [
              {
                key: 'full-access',
                title: 'Full access',
                icon: sandboxModeIcons[sandboxMode]
              } satisfies SelectorIconItem
            ]
          : []),
        ...(modelConfig.selectedReasoningEffortPresentation.showStatusIcon &&
        modelConfig.reasoningSelectionAvailable
          ? [
              {
                key: 'reasoning',
                title: `${modelConfig.selectedReasoningEffortLabel} reasoning`,
                icon: modelConfig.selectedReasoningEffortPresentation.icon
              } satisfies SelectorIconItem
            ]
          : []),
        ...(fastSpeedSelected
          ? [
              {
                key: 'speed',
                title: `${modelConfig.selectedServiceTierLabel} speed`,
                icon: <Zap className={fastServiceTierIconClassName} aria-hidden="true" />
              } satisfies SelectorIconItem
            ]
          : []),
        ...(questionsSelectorVisible && agentMode === 'autopilot'
          ? [
              {
                key: 'autopilot',
                title: 'Autopilot',
                icon: <Rocket aria-hidden="true" />
              } satisfies SelectorIconItem
            ]
          : [])
      ]
  return {
    questionsSelectorVisible,
    chatConfigSections,
    chatConfigSelectorTitle,
    chatConfigStatusIcons
  }
}
