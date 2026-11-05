import { memo } from 'react'
import { getChatPresetChanges } from '../chatPresets'
import { useComposerAccessOptions } from '../composer/useComposerAccessOptions'
import { useComposerConfigSections } from '../composer/useComposerConfigSections'
import { useComposerModelOptions } from '../composer/useComposerModelOptions'
import { useComposerPresets } from '../composer/useComposerPresets'
import {
ChatConfigDropdown
} from './ChatConfigDropdown'
import { ProviderIcon } from './ProviderIcon'

import type { MessageBoxProps } from './MessageBox.types'

type ComposerSettingsProps = Pick<
  MessageBoxProps,
  | 'agentMode'
  | 'agentModes'
  | 'agentModesLoading'
  | 'approvalMode'
  | 'approvalModes'
  | 'model'
  | 'models'
  | 'modelsError'
  | 'modelsLoading'
  | 'modelsUnavailable'
  | 'providerId'
  | 'providerUpdating'
  | 'reasoningEffort'
  | 'sandboxMode'
  | 'sandboxModes'
  | 'serviceTier'
  | 'presetsEnabled'
  | 'selectionAction'
  | 'showAccessSelector'
  | 'showModelSelector'
  | 'showReasoningSelector'
  | 'showReviewSelector'
  | 'showSpeedSelector'
  | 'onAgentModeChange'
  | 'onApprovalModeChange'
  | 'onModelChange'
  | 'onPresetChange'
  | 'onReasoningEffortChange'
  | 'onSandboxModeChange'
  | 'onServiceTierChange'
>

// Draft edits do not change these props; preserve the dropdown tree while typing.
export const ComposerSettings = memo(function ComposerSettings({
  agentMode,
  agentModes,
  agentModesLoading = false,
  approvalMode,
  approvalModes,
  model,
  models,
  modelsError = null,
  modelsLoading = false,
  modelsUnavailable = false,
  providerId,
  providerUpdating = false,
  reasoningEffort,
  sandboxMode,
  sandboxModes,
  serviceTier,
  presetsEnabled = true,
  selectionAction = 'back',
  showAccessSelector = true,
  showModelSelector = true,
  showReasoningSelector = true,
  showReviewSelector = true,
  showSpeedSelector = true,
  onAgentModeChange,
  onApprovalModeChange,
  onModelChange,
  onPresetChange,
  onReasoningEffortChange,
  onSandboxModeChange,
  onServiceTierChange
}: ComposerSettingsProps) {
const modelConfig = useComposerModelOptions({models,model,modelsUnavailable,modelsLoading,providerId,serviceTier,reasoningEffort})
const accessConfig = useComposerAccessOptions({sandboxMode,showReviewSelector,approvalMode,approvalModes,sandboxModes})
const sections = useComposerConfigSections({providerId,agentModesLoading,agentModes,agentMode,showModelSelector,providerUpdating,modelConfig,model,onModelChange,showReasoningSelector,reasoningEffort,onReasoningEffortChange,onAgentModeChange,showAccessSelector,accessConfig,sandboxMode,onSandboxModeChange,onApprovalModeChange,showSpeedSelector,onServiceTierChange})

const presetConfig = useComposerPresets({agentMode,accessConfig,model,reasoningEffort,sandboxMode,serviceTier,showModelSelector,showReasoningSelector,showAccessSelector,showReviewSelector,questionsSelectorVisible: sections.questionsSelectorVisible,agentModesLoading,showSpeedSelector,models,agentModes,providerUpdating,modelConfig})


  return (
    <ChatConfigDropdown
      id="chat-config-mode"
      key={providerId}
      presetsEnabled={presetsEnabled}
      selectionAction={selectionAction}
      providerId={providerId}
      selection={presetConfig.currentPresetSelection}
      getPresetDetails={presetConfig.getPresetDetails}
      onPresetChange={(preset) =>
        onPresetChange(getChatPresetChanges(preset, presetConfig.presetEditableFields))
      }
      modelsError={modelsError}
      modelLabel={modelConfig.selectedModelLabel}
      providerIcon={<ProviderIcon providerId={providerId} />}
      reasoningLabel={
        modelConfig.modelSelectionUnavailable || !modelConfig.reasoningSelectionAvailable
          ? null
          : modelConfig.selectedReasoningEffortLabel
      }
      sections={sections.chatConfigSections}
      statusIcons={sections.chatConfigStatusIcons}
      title={sections.chatConfigSelectorTitle}
    />
  )
})
