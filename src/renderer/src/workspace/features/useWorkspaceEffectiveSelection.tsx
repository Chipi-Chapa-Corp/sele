import { useMemo } from 'react'
import type { ProviderModelId } from '../../../../shared/provider'
import { formatModelLabel } from '../../composer/configPresentation'
import { resolveEffectiveModel } from '../../modelSelection'
import { appChatManualDropdownValue, appChatStandardSpeedValue } from '../../settings'
import { getDefaultReasoningEffort } from '../appearanceControllerUtils'
import { modelSupportsReasoningEffort, modelSupportsServiceTier } from '../chatControllerUtils'
import type { WorkspaceSession } from '../useWorkspaceSelection'

export function useWorkspaceEffectiveSelection({
  provider,
  settings,
  providerState,
  catalogs
}: WorkspaceSession) {
  const resolvedModelIdsById = useMemo(
    () =>
      new Map<ProviderModelId, ProviderModelId>(
        provider.models.flatMap((model) =>
          model.resolvedModelId ? [[model.id, model.resolvedModelId]] : []
        )
      ),
    [provider.models]
  )

  const modelLabelsById = useMemo(
    () =>
      new Map<ProviderModelId, string>(
        provider.models.map((candidateModel) => [
          candidateModel.id,
          formatModelLabel(candidateModel.label)
        ])
      ),
    [provider.models]
  )

  const effectiveSandboxMode =
    settings.effectiveAppSettings.chat.forceAccess === appChatManualDropdownValue
      ? providerState.sandboxMode
      : settings.effectiveAppSettings.chat.forceAccess

  const effectiveAgentMode = providerState.agentModes.some(
    (mode) => mode.id === providerState.agentMode
  )
    ? providerState.agentMode
    : 'interactive'

  const configuredApprovalMode =
    settings.effectiveAppSettings.chat.forceReview === appChatManualDropdownValue
      ? providerState.approvalMode
      : settings.effectiveAppSettings.chat.forceReview

  const effectiveApprovalMode =
    effectiveSandboxMode === 'danger-full-access' ? 'never' : configuredApprovalMode

  const forcedModel =
    settings.effectiveAppSettings.chat.forceModel === appChatManualDropdownValue
      ? null
      : settings.effectiveAppSettings.chat.forceModel

  const resolvedModel = resolveEffectiveModel(
    provider.models,
    providerState.model,
    forcedModel,
    catalogs.activeModelCatalog,
    catalogs.modelAccountKey
      ? providerState.accountModelPreferencesRef.current[catalogs.modelAccountKey]
      : undefined
  )

  const effectiveModel =
    provider.configProviderId === 'opencode-v2' &&
    !provider.models.some((model) => model.id === resolvedModel)
      ? (provider.models.find((model) => model.isDefault)?.id ?? provider.models[0]?.id ?? '')
      : resolvedModel

  const selectedEffectiveModel = provider.models.find(
    (candidateModel) => candidateModel.id === effectiveModel
  )

  const configuredServiceTier =
    settings.effectiveAppSettings.chat.forceSpeed === appChatManualDropdownValue
      ? providerState.serviceTier
      : settings.effectiveAppSettings.chat.forceSpeed === appChatStandardSpeedValue
        ? null
        : settings.effectiveAppSettings.chat.forceSpeed

  const effectiveServiceTier = modelSupportsServiceTier(
    selectedEffectiveModel,
    configuredServiceTier
  )
    ? configuredServiceTier
    : (selectedEffectiveModel?.defaultServiceTier ?? null)

  const configuredReasoningEffort =
    settings.effectiveAppSettings.chat.forceReasoning === appChatManualDropdownValue
      ? providerState.reasoningEffort
      : settings.effectiveAppSettings.chat.forceReasoning

  const effectiveReasoningEffort = modelSupportsReasoningEffort(
    selectedEffectiveModel,
    configuredReasoningEffort
  )
    ? configuredReasoningEffort
    : getDefaultReasoningEffort(selectedEffectiveModel)

  const hasForcedChatDropdown =
    settings.effectiveAppSettings.chat.forceAccess !== appChatManualDropdownValue ||
    settings.effectiveAppSettings.chat.forceReview !== appChatManualDropdownValue ||
    settings.effectiveAppSettings.chat.forceModel !== appChatManualDropdownValue ||
    settings.effectiveAppSettings.chat.forceReasoning !== appChatManualDropdownValue ||
    settings.effectiveAppSettings.chat.forceSpeed !== appChatManualDropdownValue
  return {
    resolvedModelIdsById,
    modelLabelsById,
    effectiveSandboxMode,
    effectiveAgentMode,
    effectiveApprovalMode,
    effectiveModel,
    selectedEffectiveModel,
    effectiveServiceTier,
    effectiveReasoningEffort,
    hasForcedChatDropdown
  }
}
