import { type MessageBoxSelection } from '../../messageBoxPreferences'
import { getDefaultReasoningEffort } from '../appearanceControllerUtils'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceEffectiveSelection } from './useWorkspaceEffectiveSelection'
import { useWorkspaceProviderContext } from './useWorkspaceProviderContext'

type WorkspaceChatPresetDependencies = {
  providerState: ReturnType<typeof useWorkspaceProviderState>
  provider: ReturnType<typeof useWorkspaceProviderContext>
  effectiveSelection: ReturnType<typeof useWorkspaceEffectiveSelection>
}

export function useWorkspaceChatPreset({
  providerState,
  provider,
  effectiveSelection
}: WorkspaceChatPresetDependencies) {
  const handleChatPresetChange = (selection: Partial<MessageBoxSelection>): void => {
    // Apply the complete combination in one render, including transitions out of full access.
    if (selection.model !== undefined) {
      providerState.modelManuallySelectedRef.current = true
      providerState.setModel(selection.model)
      if (selection.reasoningEffort === undefined) {
        providerState.reasoningManuallySelectedRef.current = false
        providerState.setReasoningEffort(
          getDefaultReasoningEffort(
            provider.models.find((candidate) => candidate.id === selection.model)
          )
        )
      }
    }
    if (selection.reasoningEffort !== undefined) {
      providerState.reasoningManuallySelectedRef.current = true
      providerState.setReasoningEffort(selection.reasoningEffort)
    }
    if (selection.sandboxMode !== undefined) {
      providerState.sandboxModeManuallySelectedRef.current = true
      if (selection.sandboxMode === 'danger-full-access') {
        if (providerState.sandboxMode !== 'danger-full-access') {
          providerState.approvalModeBeforeFullAccessRef.current =
            providerState.approvalMode === 'never' ? null : providerState.approvalMode
        }
        providerState.setApprovalMode('never')
      } else if (providerState.sandboxMode === 'danger-full-access') {
        providerState.setApprovalMode(
          providerState.approvalModeBeforeFullAccessRef.current ?? 'ask-user'
        )
        providerState.approvalModeBeforeFullAccessRef.current = null
      }
      providerState.setSandboxMode(selection.sandboxMode)
    }
    if (
      selection.approvalMode !== undefined &&
      (selection.sandboxMode ?? effectiveSelection.effectiveSandboxMode) !== 'danger-full-access'
    ) {
      providerState.approvalModeManuallySelectedRef.current = true
      providerState.setApprovalMode(selection.approvalMode)
    }
    if (selection.agentMode !== undefined) providerState.setAgentMode(selection.agentMode)
    if (selection.serviceTier !== undefined) providerState.setServiceTier(selection.serviceTier)
  }
  return { handleChatPresetChange }
}
