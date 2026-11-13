import { useRef, useState } from 'react'
import type { AppContainerTarget } from '../../../../shared/app'
import type {
  ProviderAgentMode,
  ProviderAgentModeOption,
  ProviderApprovalMode,
  ProviderApprovalModeOption,
  ProviderId,
  ProviderModel,
  ProviderModelId,
  ProviderReasoningEffort,
  ProviderSandboxMode,
  ProviderSandboxModeOption,
  ProviderServiceTier
} from '../../../../shared/provider'
import {
  fallbackProviderApprovalModes,
  fallbackProviderModels,
  fallbackProviderSandboxModes
} from '../../../../shared/provider'
import {
  type SettingsProviderApp,
  type SettingsProviderSkill
} from '../../../../shared/providerOwnership'
import { type ProviderResourcesLoadState } from '../../components/SettingsPanel'
import { type MessageBoxSelection } from '../../messageBoxPreferences'
import {
  fallbackDefaultApprovalMode,
  fallbackDefaultSandboxMode,
  fallbackInitialModel,
  fallbackInitialReasoningEffort,
  type DeferredProviderResourceRefresh
} from '../controllerTypes'
import { useWorkspacePreferenceState } from './useWorkspacePreferenceState'

type WorkspaceProviderStateDependencies = {
  preferences: ReturnType<typeof useWorkspacePreferenceState>
}

export function useWorkspaceProviderState({ preferences }: WorkspaceProviderStateDependencies) {
  const [settingsProviderSkills, setSettingsProviderSkills] = useState<SettingsProviderSkill[]>([])

  const [settingsProviderApps, setSettingsProviderApps] = useState<SettingsProviderApp[]>([])

  const [providerAccountsRefresh, setProviderAccountsRefresh] = useState(0)

  const [providerAccountRevision, setProviderAccountRevision] = useState(0)

  const [providerAccountUpdatingId, setProviderAccountUpdatingId] = useState<string | null>(null)

  const [accountDialogOpen, setAccountDialogOpen] = useState(false)

  const [openCodeProviderManagerSource, setOpenCodeProviderManagerSource] = useState<string | null>(
    null
  )

  const [reauthenticationTarget, setReauthenticationTarget] = useState<{
    providerId: 'codex' | 'claude'
    container: AppContainerTarget | null
    chatId?: string
  } | null>(null)

  const [providerResourcesLoadState, setProviderResourcesLoadState] =
    useState<ProviderResourcesLoadState>('idle')

  const [providerResourcesError, setProviderResourcesError] = useState<string | null>(null)

  const [providerResourceUpdatingKey, setProviderResourceUpdatingKey] = useState<string | null>(
    null
  )

  const [providerResourcesRefresh, setProviderResourcesRefresh] = useState(0)

  const [providerResourcesRevision, setProviderResourcesRevision] = useState(0)

  const [providerModelsRevision, setProviderModelsRevision] = useState(0)

  const [approvalModes, setApprovalModes] = useState<ProviderApprovalModeOption[]>(
    fallbackProviderApprovalModes
  )

  const [agentMode, setAgentMode] = useState<ProviderAgentMode>(
    preferences.storedMessageBoxSelection.agentMode ?? 'interactive'
  )

  const [agentModes, setAgentModes] = useState<ProviderAgentModeOption[]>([])

  const [agentModesLoading, setAgentModesLoading] = useState(false)

  const [approvalMode, setApprovalMode] = useState<ProviderApprovalMode>(
    preferences.storedMessageBoxSelection.approvalMode ?? fallbackDefaultApprovalMode
  )

  const [sandboxModes, setSandboxModes] = useState<ProviderSandboxModeOption[]>(
    fallbackProviderSandboxModes
  )

  const [sandboxMode, setSandboxMode] = useState<ProviderSandboxMode>(
    preferences.storedMessageBoxSelection.sandboxMode ?? fallbackDefaultSandboxMode
  )

  const [allModels, setModels] = useState<ProviderModel[]>(fallbackProviderModels)

  const [modelsError, setModelsError] = useState<string | null>(null)

  const [modelsLoading, setModelsLoading] = useState(false)

  const [gitSettingsModels, setGitSettingsModels] = useState<ProviderModel[]>([])

  const [gitSettingsModelsLoading, setGitSettingsModelsLoading] = useState(false)

  const providerModelCatalogCacheRef = useRef(new Map<string, ProviderModel[]>())

  const accountModelPreferencesRef = useRef(preferences.storedAccountModelPreferences)

  const [modelCatalogIdentity, setModelCatalogIdentity] = useState<{
    key: string
    revision: number
    accountKey: string | null
  } | null>(null)

  const [displayedModelCatalogKey, setDisplayedModelCatalogKey] = useState<string | null>(null)

  const [displayedGitSettingsModelCatalogKey, setDisplayedGitSettingsModelCatalogKey] = useState<
    string | null
  >(null)

  const [model, setModel] = useState<ProviderModelId>(
    preferences.storedMessageBoxSelection.model ?? fallbackInitialModel.id
  )

  const [reasoningEffort, setReasoningEffort] = useState<ProviderReasoningEffort>(
    preferences.storedMessageBoxSelection.reasoningEffort ?? fallbackInitialReasoningEffort
  )

  const [serviceTier, setServiceTier] = useState<ProviderServiceTier | null>(
    preferences.storedMessageBoxSelection.serviceTier ?? null
  )

  const deferredProviderResourceRefreshesRef = useRef(
    new Map<string, DeferredProviderResourceRefresh>()
  )

  const deferredProviderResourceRefreshRunningRef = useRef(false)

  const messageBoxSelectionsRef = useRef(preferences.storedMessageBoxSelections)

  const chatMessageBoxSelectionsRef = useRef(preferences.storedChatMessageBoxSelections)

  const lastMessageBoxSelectionRef = useRef<MessageBoxSelection | null>(null)

  const messageBoxSelectionChatKeyRef = useRef<string | null>(null)

  const messageBoxSelectionProviderRef = useRef<ProviderId>('codex')

  const modelManuallySelectedRef = useRef(Boolean(preferences.storedMessageBoxSelection.model))

  const reasoningManuallySelectedRef = useRef(
    Boolean(preferences.storedMessageBoxSelection.reasoningEffort)
  )

  const approvalModeManuallySelectedRef = useRef(
    Boolean(preferences.storedMessageBoxSelection.approvalMode)
  )

  const sandboxModeManuallySelectedRef = useRef(
    Boolean(preferences.storedMessageBoxSelection.sandboxMode)
  )

  const approvalModeBeforeFullAccessRef = useRef<ProviderApprovalMode | null>(null)
  return {
    settingsProviderSkills,
    setSettingsProviderSkills,
    settingsProviderApps,
    setSettingsProviderApps,
    providerAccountsRefresh,
    setProviderAccountsRefresh,
    providerAccountRevision,
    setProviderAccountRevision,
    providerAccountUpdatingId,
    setProviderAccountUpdatingId,
    accountDialogOpen,
    setAccountDialogOpen,
    openCodeProviderManagerSource,
    setOpenCodeProviderManagerSource,
    reauthenticationTarget,
    setReauthenticationTarget,
    providerResourcesLoadState,
    setProviderResourcesLoadState,
    providerResourcesError,
    setProviderResourcesError,
    providerResourceUpdatingKey,
    setProviderResourceUpdatingKey,
    providerResourcesRefresh,
    setProviderResourcesRefresh,
    providerResourcesRevision,
    setProviderResourcesRevision,
    providerModelsRevision,
    setProviderModelsRevision,
    approvalModes,
    setApprovalModes,
    agentMode,
    setAgentMode,
    agentModes,
    setAgentModes,
    agentModesLoading,
    setAgentModesLoading,
    approvalMode,
    setApprovalMode,
    sandboxModes,
    setSandboxModes,
    sandboxMode,
    setSandboxMode,
    allModels,
    setModels,
    modelsError,
    setModelsError,
    modelsLoading,
    setModelsLoading,
    gitSettingsModels,
    setGitSettingsModels,
    gitSettingsModelsLoading,
    setGitSettingsModelsLoading,
    providerModelCatalogCacheRef,
    accountModelPreferencesRef,
    modelCatalogIdentity,
    setModelCatalogIdentity,
    displayedModelCatalogKey,
    setDisplayedModelCatalogKey,
    displayedGitSettingsModelCatalogKey,
    setDisplayedGitSettingsModelCatalogKey,
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    serviceTier,
    setServiceTier,
    deferredProviderResourceRefreshesRef,
    deferredProviderResourceRefreshRunningRef,
    messageBoxSelectionsRef,
    chatMessageBoxSelectionsRef,
    lastMessageBoxSelectionRef,
    messageBoxSelectionChatKeyRef,
    messageBoxSelectionProviderRef,
    modelManuallySelectedRef,
    reasoningManuallySelectedRef,
    approvalModeManuallySelectedRef,
    sandboxModeManuallySelectedRef,
    approvalModeBeforeFullAccessRef
  }
}
