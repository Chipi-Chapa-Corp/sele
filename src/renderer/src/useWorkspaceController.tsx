import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  Bot,
  FolderKanban,
  FolderTree,
  GitBranch,
  LayoutList,
  Maximize2,
  Minimize2,
  Minus,
  MessageSquare,
  Monitor,
  Pencil,
  Server,
  Settings,
  X
} from 'lucide-react'
import type {
  AppContainerSuggestion,
  AppContainerTarget,
  AppLocalContainerTarget,
  AppCreateSshEnvironmentOptions,
  AppProject,
  AppSshEnvironment,
  AppFileTreeResult,
  AppGitBranchesResult,
  AppGitChangesResult,
  AppProjectIcon,
  AppWindowState
} from '../../shared/app'
import type { BrowserOpenRequest } from '../../shared/browser'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatUpdateSummary,
  ProviderChatItem,
  ProviderChatMetadata,
  ProviderCwdNote,
  ProviderAgentMode,
  ProviderAgentModeOption,
  ProviderApprovalMode,
  ProviderApprovalModeOption,
  ProviderId,
  ProviderModel,
  ProviderModelId,
  ProviderAccountUsage,
  ProviderAccountConfiguration,
  ProviderReasoningEffort,
  ProviderServiceTier,
  ProviderReview,
  ProviderReviewComment,
  ProviderSandboxMode,
  ProviderSandboxModeOption
} from '../../shared/provider'
import { type ProviderChatTurn } from '../../shared/chatTurns'
import {
  resolveSettingsProviderSkillUpdates,
  type SettingsProviderApp,
  type SettingsProviderSkill
} from '../../shared/providerOwnership'
import {
  fallbackProviderApprovalModes,
  fallbackProviderModels,
  fallbackProviderSandboxModes,
  providerIds
} from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import type { AccountAuthorizationSession } from './components/AccountDialog'
import {
  getChatCommitMarkerTerminalStatus,
  getRecoveredChatCommitMarkerTerminalStatus
} from './chatCommitMarker'
import { type PinnedChatTextReference, type RecentChatReference } from './chatRecents'
import { type ChatListGroupData } from './components/ChatListGroup'
import { Button } from './components/Button'
import type { ChatPlanData } from './components/ChatPlan'
import type { DropdownOption } from './components/Dropdown'
import type { FileEditorTarget } from './components/FileEditorDialog'
import { getReasoningEffortPresentation } from './reasoningEffortPresentation'
import { reconcileModelSelection, reconcileReasoningSelection } from './modelSelection'
import type { MessageBoxQuoteRequest } from './components/MessageBox'
import type { TerminalCommandLaunchRequest } from './components/TerminalPanel'
import { appApi } from './appApi'
import { browserApi } from './browserApi'
import {
  getComparableChatPreview,
  isViewedChatCompletion,
  mergeChatMetadata,
  type ComparableChatPreview
} from './chatMetadata'
import {
  readStoredCollapsedProjectGroups,
  writeStoredCollapsedProjectGroups
} from './collapsedProjectGroups'
import { applyFontAppearancePreferences } from './fontAppearance'
import { providerApi } from './providerApi'
import { getProjectDisplayName, renderProjectGlyph } from './projectPresentation'
import {
  readStoredPinnedRecentChatReferences,
  writeStoredPinnedRecentChatReferences,
  type PinnedRecentChatReferencesByChat
} from './recentReferencePins'
import {
  readStoredRecentlyOpenedFiles,
  writeStoredRecentlyOpenedFiles,
  type RecentlyOpenedFilesByWorkspace
} from './recentlyOpenedFiles'
import {
  type AppChatDropdownSettings,
  type AppProjectSettingsByCwd,
  type AppSettings,
  appAppearanceZoomLevelToPercent,
  appChatManualDropdownValue,
  appChatStandardSpeedValue,
  normalizeAppProjectSettingsCwd,
  normalizeAppAppearanceZoomLevel,
  readStoredAppProjectSettings,
  readStoredAppSettings,
  resolveAppSettings,
  writeStoredAppProjectSettings,
  writeStoredAppSettings
} from './settings'
import { getAppGitCommitModel } from './gitCommitModels'
import { setThemePreference } from './systemColorScheme'
import {
  clearChatSearchHighlights,
  scrollChatSearchMatchIntoView,
  setChatSearchHighlights
} from './chatSearch'
import {
  getEffectiveChatTurnWindow,
  getLatestChatTurnWindow,
  type ChatTurnWindow
} from './chatTurnWindow'
import { type PatchFilterScope } from './changeTree'
import {
  clamp,
  getScrollBottomTop,
  readChatScrollAnchor,
  type ChatScrollAnchor
} from './chatLayout'
import {
  getContainerSelectionValue,
  getContainerSuggestionState,
  getContainerTargetFromSuggestion,
  getContainerTargetKey,
  getContainerToolIcon,
  hostContainerValue,
  isContainerTargetAvailable,
  normalizeContainerTarget,
  readStoredContainerSelection,
  writeStoredContainerSelection
} from './containerSelection'
import {
  getFallbackModels,
  getProviderUpdatePreference,
  mergeSettingsProviderSkills,
  readStoredProviderUpdatePreferences,
  shouldSuggestProviderUpdate,
  writeStoredProviderUpdatePreferences,
  type ProviderUpdatePreferences,
  type ProviderUpdateSuggestion
} from './providerSettings'
import {
  isAppProjectSettingOverridden,
  setAppProjectSettingOverrideValue,
  setAppProjectSettingsForCwd,
  type AppProjectSettingPath
} from './appProjectSettings'
import {
  chatApprovalModeIcons,
  chatSandboxModeIcons,
  formatModelLabel,
  formatSelectionLabel,
  getChatServiceTierIcon,
  providerOptions,
  readStoredMessageBoxSelections,
  writeStoredMessageBoxSelections,
  type MessageBoxSelection
} from './messageBoxPreferences'
import { type ChatCommitMarker } from './components/AppStatusStates'
import {
  readStoredChatCommitMarkers,
  readStoredContinuedStoppedWorkingSteps,
  readStoredScopedCommitActivities,
  writeStoredChatCommitMarkers,
  writeStoredContinuedStoppedWorkingSteps,
  writeStoredScopedCommitActivities,
  type ContinuedStoppedWorkingStepsByChat,
  type ScopedCommitActivity,
  type StartingScopedCommitActivity
} from './chatCommitStorage'
import {
  type ProviderResourcesLoadState,
  type SettingsPanelProps,
  type SettingsTab
} from './components/SettingsPanel'
import type { SettingsScope } from './components/SettingsDialog'
import { useChatPaneLayout } from './useChatPaneLayout'
import {
  getChatDetailTurnCount,
  preserveOptimisticChatDetail,
  retainLoadedChatDetailTurnWindow,
  shouldPreserveOptimisticTurnUntilUserMessage
} from './chatDetailWindow'
import {
  activeGroupKey,
  chatListFetchPageSize,
  chatTurnWindowSize,
  commitActionLabels,
  doneGroupKey,
  fallbackDefaultApprovalMode,
  fallbackDefaultSandboxMode,
  fallbackInitialModel,
  fallbackInitialReasoningEffort,
  getFixedChangeSource,
  gitCurrentChatModelValue,
  newSessionProjectPlaceholderValue,
  readChatGroupingPreference,
  streamingChatUpdateIntervalMs,
  writeChatGroupingPreference,
  type ApplyChatDetailOptions,
  type ApprovalResolutionState,
  type CachedPatchChangedFiles,
  type ChangesPaneView,
  type ChatGroupingPreference,
  type ChatTurnPageLoadDirection,
  type CommittedChatUpdate,
  type CommitChatReturnTarget,
  type DeferredProviderResourceRefresh,
  type DirectCommitActivity,
  type EditingMessage,
  type FileTreeScope,
  type GitBranchDeleteRetry,
  type GitBranchWorktreeDeleteRetry,
  type GitBranchesScope,
  type GitChangesScope,
  type GitCommitMode,
  type GitSyncRecoveryState,
  type RecentChatCacheEntry,
  type LoadState,
  type NewSessionLocation,
  type ProviderUpdateState,
  type ScopedGitOperationError,
  type SendState,
  type SourceAvailabilityState,
  type SubagentChatView,
  type SubagentListState,
  type UncommittedPatchFilter,
  type UsageLoadState,
  type UserInputResolutionState,
  type WorktreeCreationState
} from './workspace/controllerTypes'
import {
  applyShadowPreference,
  applyWindowControlAppearancePreferences,
  getApprovalSummary,
  getGitRecoveryActionIcon,
  getGitRecoveryRememberLabel,
  getProviderUpdateSummary
} from './workspace/gitControllerUtils'
import {
  approvalTypeLabels,
  getDefaultApprovalMode,
  getDefaultModel,
  getDefaultReasoningEffort,
  getDefaultSandboxMode,
  modelHasServiceTierOptions
} from './workspace/appearanceControllerUtils'
import {
  areChatsEqual,
  areContainerTargetsEqual,
  getChatCwdGroupKey,
  getChatCwdLabel,
  getChatDetailFromUpdate,
  getChatDetailFromUpdateSummary,
  getChatFromDetail,
  getChatFromUpdateSummary,
  getChatKey,
  getChatProjectCwd,
  getCollapsedGroupState,
  getCommitActivityCurrentAction,
  getCommitActivityCurrentActionFromSummary,
  getErrorMessage,
  getFolderDescription,
  getFolderName,
  getLastChatCommitMarkerAnchorId,
  getProviderChatKey,
  groupChatsForSidebar,
  isActiveChatStatus,
  mergeChats,
  mergeProjects,
  modelSupportsReasoningEffort,
  modelSupportsServiceTier,
  sortChatsForGroup,
  trimRecentChatCache
} from './workspace/chatControllerUtils'
import { useGitViewModel } from './workspace/useGitViewModel'
import { useFileNavigationController } from './workspace/useFileNavigationController'
import { useCommitController } from './workspace/useCommitController'
import { useSubagentController } from './workspace/useSubagentController'
import { useGitSyncController } from './workspace/useGitSyncController'
import { useSettingsController } from './workspace/useSettingsController'
import { useChatListController } from './workspace/useChatListController'
import { useChatMessagingController } from './workspace/useChatMessagingController'
import { useChatInteractionController } from './workspace/useChatInteractionController'
import { useConversationViewModel } from './workspace/useConversationViewModel'
import { useChangesData } from './workspace/useChangesData'
import { useWorkspaceSelection } from './workspace/useWorkspaceSelection'

// The return type intentionally stays inferred so every view slice remains exact.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const useWorkspaceController = () => {
  const storedMessageBoxSelections = useMemo(() => readStoredMessageBoxSelections(), [])
  const storedMessageBoxSelection = storedMessageBoxSelections.codex ?? {}
  const [appSettings, setAppSettings] = useState<AppSettings>(readStoredAppSettings)
  const [projectSettingsByCwd, setProjectSettingsByCwd] = useState<AppProjectSettingsByCwd>(
    readStoredAppProjectSettings
  )
  const [appearanceZoomLevelInputDraft, setAppearanceZoomLevelInputDraft] = useState<{
    key: string
    value: string
  } | null>(null)
  const [browserDefaultScaleInputDraft, setBrowserDefaultScaleInputDraft] = useState<{
    key: string
    value: string
  } | null>(null)
  const [appearanceFontSizeInputDraft, setAppearanceFontSizeInputDraft] = useState<{
    key: string
    value: string
  } | null>(null)
  const [installedFontFamilies, setInstalledFontFamilies] = useState<string[]>([])
  const [installedFontsLoaded, setInstalledFontsLoaded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  const [settingsScope, setSettingsScope] = useState<SettingsScope>('global')
  const [settingsProviderSkills, setSettingsProviderSkills] = useState<SettingsProviderSkill[]>([])
  const [settingsProviderApps, setSettingsProviderApps] = useState<SettingsProviderApp[]>([])
  const [settingsProviderAccounts, setSettingsProviderAccounts] =
    useState<ProviderAccountConfiguration | null>(null)
  const [providerAccountsLoadState, setProviderAccountsLoadState] = useState<
    'idle' | 'loading' | 'ready'
  >('idle')
  const [providerAccountsError, setProviderAccountsError] = useState<string | null>(null)
  const [providerAccountsRefresh, setProviderAccountsRefresh] = useState(0)
  const [providerAccountRevision, setProviderAccountRevision] = useState(0)
  const [providerAccountUpdatingId, setProviderAccountUpdatingId] = useState<string | null>(null)
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [providerResourcesLoadState, setProviderResourcesLoadState] =
    useState<ProviderResourcesLoadState>('idle')
  const [providerResourcesError, setProviderResourcesError] = useState<string | null>(null)
  const [providerResourceUpdatingKey, setProviderResourceUpdatingKey] = useState<string | null>(
    null
  )
  const [providerResourcesRefresh, setProviderResourcesRefresh] = useState(0)
  const [providerResourcesRevision, setProviderResourcesRevision] = useState(0)
  const [providerModelsRevision, setProviderModelsRevision] = useState(0)
  const [fileEditorTarget, setFileEditorTarget] = useState<FileEditorTarget | null>(null)
  const [selectedReview, setSelectedReview] = useState<Omit<ProviderReview, 'prompt'> | null>(null)
  const [reviewCommentsDraft, setReviewCommentsDraft] = useState<ProviderReviewComment[]>([])
  const [terminalOpened, setTerminalOpened] = useState(false)
  const [terminalCommandLaunchRequest, setTerminalCommandLaunchRequest] =
    useState<TerminalCommandLaunchRequest | null>(null)
  const [browserOpened, setBrowserOpened] = useState(false)
  const [browserOpenRequest, setBrowserOpenRequest] = useState<BrowserOpenRequest | null>(null)
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
  const [chatDetail, setChatDetail] = useState<ProviderChatDetail | null>(null)
  const [recentChatReferencesCache, setRecentChatReferencesCache] = useState<{
    chatKey: string
    references: RecentChatReference[]
  } | null>(null)
  const [recentChatReferencePage, setRecentChatReferencePage] = useState<{
    chatKey: string
    items: ProviderChatItem[]
    latestItemId: string | null
    messageLimit: number
    totalTurnCount: number
  } | null>(null)
  const [pinnedRecentChatReferences, setPinnedRecentChatReferences] =
    useState<PinnedRecentChatReferencesByChat>(readStoredPinnedRecentChatReferences)
  const [recentlyOpenedFilesByWorkspace, setRecentlyOpenedFilesByWorkspace] =
    useState<RecentlyOpenedFilesByWorkspace>(readStoredRecentlyOpenedFiles)
  const [chatTurnWindow, setChatTurnWindow] = useState<ChatTurnWindow | null>(null)
  const [chatTurnPageLoadDirection, setChatTurnPageLoadDirection] =
    useState<ChatTurnPageLoadDirection | null>(null)
  const [chatAtConversationBottom, setChatAtConversationBottom] = useState(true)
  const [extractedChatPlan, setExtractedChatPlan] = useState<ChatPlanData | null>(null)
  const [chatLoadState, setChatLoadState] = useState<LoadState>('ready')
  const [chatLoadRequest, setChatLoadRequest] = useState(0)
  const [committedChatUpdate, setCommittedChatUpdate] = useState<CommittedChatUpdate | null>(null)
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendInFlightProjectKey, setSendInFlightProjectKey] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null)
  const [messageBoxQuoteRequest, setMessageBoxQuoteRequest] =
    useState<MessageBoxQuoteRequest | null>(null)
  const [approvalModes, setApprovalModes] = useState<ProviderApprovalModeOption[]>(
    fallbackProviderApprovalModes
  )
  const [agentMode, setAgentMode] = useState<ProviderAgentMode>(
    storedMessageBoxSelection.agentMode ?? 'interactive'
  )
  const [agentModes, setAgentModes] = useState<ProviderAgentModeOption[]>([])
  const [agentModesLoading, setAgentModesLoading] = useState(false)
  const [approvalMode, setApprovalMode] = useState<ProviderApprovalMode>(
    storedMessageBoxSelection.approvalMode ?? fallbackDefaultApprovalMode
  )
  const [sandboxModes, setSandboxModes] = useState<ProviderSandboxModeOption[]>(
    fallbackProviderSandboxModes
  )
  const [sandboxMode, setSandboxMode] = useState<ProviderSandboxMode>(
    storedMessageBoxSelection.sandboxMode ?? fallbackDefaultSandboxMode
  )
  const [models, setModels] = useState<ProviderModel[]>(fallbackProviderModels)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [gitSettingsModels, setGitSettingsModels] = useState<ProviderModel[]>([])
  const [gitSettingsModelsLoading, setGitSettingsModelsLoading] = useState(false)
  const providerModelCatalogCacheRef = useRef(new Map<string, ProviderModel[]>())
  const [displayedModelCatalogKey, setDisplayedModelCatalogKey] = useState<string | null>(null)
  const [displayedGitSettingsModelCatalogKey, setDisplayedGitSettingsModelCatalogKey] = useState<
    string | null
  >(null)
  const [model, setModel] = useState<ProviderModelId>(
    storedMessageBoxSelection.model ?? fallbackInitialModel.id
  )
  const [reasoningEffort, setReasoningEffort] = useState<ProviderReasoningEffort>(
    storedMessageBoxSelection.reasoningEffort ?? fallbackInitialReasoningEffort
  )
  const [serviceTier, setServiceTier] = useState<ProviderServiceTier | null>(
    storedMessageBoxSelection.serviceTier ?? null
  )
  const [approvalResolution, setApprovalResolution] = useState<ApprovalResolutionState>({
    approvalId: null,
    decision: null,
    error: null
  })
  const [userInputResolution, setUserInputResolution] = useState<UserInputResolutionState>({
    requestId: null,
    resolving: false,
    error: null
  })
  const [providerUpdateSuggestion, setProviderUpdateSuggestion] =
    useState<ProviderUpdateSuggestion | null>(null)
  const [providerUpdateState, setProviderUpdateState] = useState<ProviderUpdateState>('idle')
  const [providerUpdateError, setProviderUpdateError] = useState<string | null>(null)
  const [providerUpdatePreferences, setProviderUpdatePreferences] =
    useState<ProviderUpdatePreferences>(readStoredProviderUpdatePreferences)
  const [containerSuggestions, setContainerSuggestions] = useState<AppContainerSuggestion[]>([])
  const [remoteContainerSuggestions, setRemoteContainerSuggestions] = useState<
    AppContainerSuggestion[]
  >([])
  const [remoteContainerSuggestionsLoading, setRemoteContainerSuggestionsLoading] = useState(false)
  const [remoteContainerSuggestionsError, setRemoteContainerSuggestionsError] = useState<
    string | null
  >(null)
  const [sshEnvironments, setSshEnvironments] = useState<AppSshEnvironment[]>([])
  const [sshEnvironmentDialogOpen, setSshEnvironmentDialogOpen] = useState(false)
  const [editingSshEnvironment, setEditingSshEnvironment] = useState<AppSshEnvironment | null>(null)
  const [deletingSshEnvironmentId, setDeletingSshEnvironmentId] = useState<string | null>(null)
  const [sshEnvironmentError, setSshEnvironmentError] = useState<string | null>(null)
  const [storedContainerSelection] = useState<AppContainerTarget | null>(
    readStoredContainerSelection
  )
  const [containerSelectionReady, setContainerSelectionReady] = useState(false)
  const [newSessionContainer, setNewSessionContainer] = useState<AppContainerTarget>(
    () => storedContainerSelection ?? { kind: 'host' }
  )
  const newSessionSshEnvironmentId =
    newSessionContainer.kind === 'container' && newSessionContainer.tool === 'ssh'
      ? newSessionContainer.name
      : null
  const newSessionContainerKey = getContainerTargetKey(newSessionContainer)
  const [newSessionSourceAvailability, setNewSessionSourceAvailability] =
    useState<SourceAvailabilityState | null>(null)
  const [accountUsage, setAccountUsage] = useState<ProviderAccountUsage | null>(null)
  const [accountUsageState, setAccountUsageState] = useState<UsageLoadState>('idle')
  const [accountUsageError, setAccountUsageError] = useState<string | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(true)
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null)
  const settingsProjectCwd = normalizeAppProjectSettingsCwd(
    selectedChat
      ? (chatDetail?.projectCwd ?? selectedChat.projectCwd ?? chatDetail?.cwd ?? selectedChat.cwd)
      : newSessionCwd
  )
  const settingsProjectOverrides = settingsProjectCwd
    ? projectSettingsByCwd[settingsProjectCwd]
    : undefined
  const effectiveAppSettings = useMemo(
    () => resolveAppSettings(appSettings, settingsProjectOverrides),
    [appSettings, settingsProjectOverrides]
  )
  const settingsViewIsProject = settingsScope === 'project' && Boolean(settingsProjectCwd)
  const settingsPanelSettings = settingsViewIsProject ? effectiveAppSettings : appSettings
  const settingsScopeKey =
    settingsViewIsProject && settingsProjectCwd ? `project:${settingsProjectCwd}` : 'global'
  const installedFontOptions = useMemo<DropdownOption<string>[]>(
    () => installedFontFamilies.map((family) => ({ value: family, label: family })),
    [installedFontFamilies]
  )
  const updateAppearanceZoomLevel = useCallback(
    (value: number, clearInputDraft = true): void => {
      const zoomLevel = normalizeAppAppearanceZoomLevel(value)
      const zoomPath = { section: 'appearance', key: 'zoomLevel' } satisfies AppProjectSettingPath

      if (clearInputDraft) setAppearanceZoomLevelInputDraft(null)

      if (
        settingsViewIsProject &&
        settingsProjectCwd &&
        isAppProjectSettingOverridden(settingsProjectOverrides, zoomPath)
      ) {
        setProjectSettingsByCwd((currentSettings) => {
          const currentOverrides = currentSettings[settingsProjectCwd] ?? {}
          const nextOverrides = setAppProjectSettingOverrideValue(
            currentOverrides,
            zoomPath,
            zoomLevel
          )
          return setAppProjectSettingsForCwd(currentSettings, settingsProjectCwd, nextOverrides)
        })
        return
      }

      setAppSettings((currentSettings) =>
        currentSettings.appearance.zoomLevel === zoomLevel
          ? currentSettings
          : {
              ...currentSettings,
              appearance: {
                ...currentSettings.appearance,
                zoomLevel
              }
            }
      )
    },
    [settingsProjectCwd, settingsProjectOverrides, settingsViewIsProject]
  )
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null)
  const [newSessionLocation, setNewSessionLocation] = useState<NewSessionLocation>('folder')
  const [worktreeCreationState, setWorktreeCreationState] = useState<WorktreeCreationState>('idle')
  const [newSessionProvider, setNewSessionProvider] = useState<ProviderId>('codex')
  const newSessionAvailableProviderIds = useMemo(
    () =>
      newSessionSourceAvailability?.containerKey === newSessionContainerKey
        ? newSessionSourceAvailability.availability.providers.flatMap((provider) =>
            provider.available ? [provider.providerId] : []
          )
        : [],
    [newSessionContainerKey, newSessionSourceAvailability]
  )
  const newSessionProviderAvailable = newSessionAvailableProviderIds.includes(newSessionProvider)
  const newSessionSourceAvailabilityReady =
    newSessionSourceAvailability?.containerKey === newSessionContainerKey
  const configProviderId = selectedChat?.providerId ?? newSessionProvider
  const configProviderHasSelectedChat = Boolean(selectedChat)
  const configProviderContainer = selectedChat ? selectedChat.container : newSessionContainer
  const configProviderContainerKey = getContainerTargetKey(configProviderContainer)
  const configProviderModelCatalogKey = `${configProviderId}:${configProviderContainerKey}`
  const configProviderContainerRef = useRef(configProviderContainer)
  useEffect(() => {
    configProviderContainerRef.current = configProviderContainer
  }, [configProviderContainer, configProviderContainerKey])
  const configProviderModelsReady =
    configProviderHasSelectedChat ||
    (newSessionSourceAvailabilityReady && newSessionProviderAvailable && loadState !== 'loading')
  const gitSettingsModelCatalogKey = `${newSessionProvider}:${newSessionContainerKey}`
  const gitSettingsUsesConfigProviderModels =
    gitSettingsModelCatalogKey === configProviderModelCatalogKey
  const gitSettingsModelsReady =
    newSessionSourceAvailabilityReady && newSessionProviderAvailable && loadState !== 'loading'
  const [projects, setProjects] = useState<AppProject[]>([])
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [chatSearchMatchCount, setChatSearchMatchCount] = useState(0)
  const [chatSearchActiveIndex, setChatSearchActiveIndex] = useState(0)
  const [chatGroupingPreference, setChatGroupingPreference] = useState<ChatGroupingPreference>(
    readChatGroupingPreference
  )
  const [collapsedCwdGroups, setCollapsedCwdGroups] = useState<Record<string, boolean>>(
    readStoredCollapsedProjectGroups
  )
  const [draggedProjectGroupKey, setDraggedProjectGroupKey] = useState<string | null>(null)
  const [projectDropInsertionIndex, setProjectDropInsertionIndex] = useState<number | null>(null)
  const [visibleChatPageCountsByGroup, setVisibleChatPageCountsByGroup] = useState<
    Record<string, number>
  >({})
  const [cwdNotesByGroup, setCwdNotesByGroup] = useState<Record<string, ProviderCwdNote[]>>({})
  const [projectIconsByGroup, setProjectIconsByGroup] = useState<
    Record<string, AppProjectIcon | null>
  >({})
  const changeSource = getFixedChangeSource()
  const [changesPaneView, setChangesPaneView] = useState<ChangesPaneView>('git')
  const [changesSidebarExpanded, setChangesSidebarExpanded] = useState(false)
  const { changesResizeHandleRef, handleStartChatResize, panelsRef, panelsStyle, resizeHandleRef } =
    useChatPaneLayout(changesSidebarExpanded)
  const [gitChanges, setGitChanges] = useState<AppGitChangesResult | null>(null)
  const [gitChangesScope, setGitChangesScope] = useState<GitChangesScope | null>(null)
  const [gitChangeLoadState, setGitChangeLoadState] = useState<LoadState>('ready')
  const [gitChangeLoadScope, setGitChangeLoadScope] = useState<GitChangesScope | null>(null)
  const [gitChangeLoadError, setGitChangeLoadError] =
    useState<ScopedGitOperationError<GitChangesScope> | null>(null)
  const [gitChangeLoadErrorDismissed, setGitChangeLoadErrorDismissed] = useState(false)
  const [gitChangeLoadRequest, setGitChangeLoadRequest] = useState(0)
  const [gitBranches, setGitBranches] = useState<AppGitBranchesResult | null>(null)
  const [gitBranchesScope, setGitBranchesScope] = useState<GitBranchesScope | null>(null)
  const [gitBranchLoadState, setGitBranchLoadState] = useState<LoadState>('ready')
  const [gitBranchLoadRequest, setGitBranchLoadRequest] = useState(0)
  const [gitBranchActionState, setGitBranchActionState] = useState<SendState>('idle')
  const [gitBranchError, setGitBranchError] = useState<string | null>(null)
  const [gitBranchDeleteRetry, setGitBranchDeleteRetry] = useState<GitBranchDeleteRetry | null>(
    null
  )
  const [gitBranchWorktreeDeleteRetry, setGitBranchWorktreeDeleteRetry] =
    useState<GitBranchWorktreeDeleteRetry | null>(null)
  const [gitSourceAvailability, setGitSourceAvailability] =
    useState<SourceAvailabilityState | null>(null)
  const [lastGitAvailable, setLastGitAvailable] = useState<boolean | null>(null)
  const [gitAvailabilityChangeId, setGitAvailabilityChangeId] = useState(0)
  const [uncommittedPatchFilter, setUncommittedPatchFilter] =
    useState<UncommittedPatchFilter | null>(null)
  const [uncommittedPatchFilterState, setUncommittedPatchFilterState] = useState<LoadState>('ready')
  const [uncommittedPatchFilterError, setUncommittedPatchFilterError] =
    useState<ScopedGitOperationError<PatchFilterScope> | null>(null)
  const [cachedPatchChangedFiles, setCachedPatchChangedFiles] =
    useState<CachedPatchChangedFiles | null>(null)
  const [fileTree, setFileTree] = useState<AppFileTreeResult | null>(null)
  const [fileTreeScope, setFileTreeScope] = useState<FileTreeScope | null>(null)
  const [fileTreeLoadState, setFileTreeLoadState] = useState<LoadState>('ready')
  const [fileTreeLoadScope, setFileTreeLoadScope] = useState<FileTreeScope | null>(null)
  const [fileTreeLoadRequest, setFileTreeLoadRequest] = useState(0)
  const [collapsedChangeTreeFolders, setCollapsedChangeTreeFolders] = useState<
    Record<string, boolean>
  >({})
  const [collapsedFileTreeFolders, setCollapsedFileTreeFolders] = useState<Record<string, boolean>>(
    {}
  )
  const [lastOpenedFileTreeFolderPath, setLastOpenedFileTreeFolderPath] = useState<string | null>(
    null
  )
  const [commitInput, setCommitInput] = useState('')
  const [gitCommitMode, setGitCommitMode] = useState<GitCommitMode>('commit')
  const [commitMessageGenerationProjectKeys, setCommitMessageGenerationProjectKeys] = useState<
    Set<string>
  >(() => new Set())
  const [commitErrorsByProjectKey, setCommitErrorsByProjectKey] = useState<Record<string, string>>(
    {}
  )
  const [scopedCommitActivities, setScopedCommitActivities] = useState<
    Record<string, ScopedCommitActivity>
  >(readStoredScopedCommitActivities)
  const [chatCommitMarkers, setChatCommitMarkers] = useState<Record<string, ChatCommitMarker>>(
    readStoredChatCommitMarkers
  )
  const [continuedStoppedWorkingStepsByChat, setContinuedStoppedWorkingStepsByChat] =
    useState<ContinuedStoppedWorkingStepsByChat>(readStoredContinuedStoppedWorkingSteps)
  const [startingScopedCommitActivities, setStartingScopedCommitActivities] = useState<
    Record<string, StartingScopedCommitActivity>
  >({})
  const [directCommitActivities, setDirectCommitActivities] = useState<
    Record<string, DirectCommitActivity>
  >({})
  const [cancelingAiCommitKeys, setCancelingAiCommitKeys] = useState<Set<string>>(() => new Set())
  const [openingAiCommitChatIds, setOpeningAiCommitChatIds] = useState<Set<string>>(() => new Set())
  const [commitChatReturnTarget, setCommitChatReturnTarget] =
    useState<CommitChatReturnTarget | null>(null)
  const [subagentListState, setSubagentListState] = useState<SubagentListState | null>(null)
  const [subagentChatView, setSubagentChatView] = useState<SubagentChatView | null>(null)
  const [cancelingSubagentIds, setCancelingSubagentIds] = useState<Set<string>>(() => new Set())
  const [syncProjectKeys, setSyncProjectKeys] = useState<Set<string>>(() => new Set())
  const [syncErrorsByProjectKey, setSyncErrorsByProjectKey] = useState<Record<string, string>>({})
  const [syncRecoveriesByProjectKey, setSyncRecoveriesByProjectKey] = useState<
    Record<string, GitSyncRecoveryState>
  >({})
  const visibleGitErrorProjectKeyRef = useRef<string | null>(null)
  const [windowState, setWindowState] = useState<AppWindowState>({ isMaximized: false })
  const contentRef = useRef<HTMLDivElement>(null)
  const subagentContentRef = useRef<HTMLDivElement>(null)
  const chatTurnWindowRef = useRef<ChatTurnWindow | null>(chatTurnWindow)
  const chatTurnPageLoadRequestRef = useRef(0)
  const subagentChatLoadRequestRef = useRef(0)
  const chatTurnPageLoadInFlightRef = useRef(false)
  const chatTurnScrollDirectionRef = useRef<'up' | 'down' | null>(null)
  const previousChatScrollTopRef = useRef<number | null>(null)
  const pendingChatScrollAnchorRef = useRef<ChatScrollAnchor | null>(null)
  const chatViewportAnchorRef = useRef<ChatScrollAnchor | null>(null)
  const chatScrollAdjustmentTargetRef = useRef<{ element: HTMLElement; top: number } | null>(null)
  const scrollToLatestTurnAfterRenderRef = useRef(false)
  const pendingPinnedMessageNavigationRef = useRef<PinnedChatTextReference | null>(null)
  const pinnedMessageScrollCleanupRef = useRef<(() => void) | null>(null)
  const chatInitialLayoutKeyRef = useRef<string | null>(null)
  const chatDetailRef = useRef<ProviderChatDetail | null>(chatDetail)
  const chatDetailResyncRef = useRef<{ chatKey: string; requestId: number } | null>(null)
  const chatDetailResyncRequestIdRef = useRef(0)
  const loadedWorkingStepIdsRef = useRef<string[]>([])
  const chatSearchContentRef = useRef<HTMLDivElement>(null)
  const chatSearchInputRef = useRef<HTMLInputElement>(null)
  const chatSearchMatchesRef = useRef<Range[]>([])
  const chatSearchActiveIndexRef = useRef(0)
  const chatSearchReturnFocusRef = useRef<HTMLElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null)
  const settingsOpenRef = useRef(settingsOpen)
  const deferredProviderResourceRefreshesRef = useRef(
    new Map<string, DeferredProviderResourceRefresh>()
  )
  const deferredProviderResourceRefreshRunningRef = useRef(false)
  const sendInFlightRef = useRef(false)
  const forkInFlightRef = useRef(false)
  const sendInFlightProjectKeyRef = useRef<string | null>(null)
  const runPromptActionRef = useRef<(prompt: string, target: 'current' | 'new') => Promise<void>>(
    async () => {}
  )
  const commitInFlightProjectKeysRef = useRef(new Set<string>())
  const commitMessageGenerationProjectKeysRef = useRef(new Set<string>())
  const syncProjectKeysRef = useRef(new Set<string>())
  const gitBranchRequestIdRef = useRef(0)
  const chatAutoScrollEnabledRef = useRef(true)
  const chatAtConversationBottomRef = useRef(chatAtConversationBottom)
  const chatAutoScrollFrameRef = useRef<number | null>(null)
  const chatAutoScrollTargetRef = useRef<{ element: HTMLElement; top: number } | null>(null)
  const chatUserScrollIntentRef = useRef(false)
  const chatUserScrollIntentFrameRef = useRef<number | null>(null)
  const chatsRef = useRef(chats)
  const selectedChatKeyRef = useRef<string | null>(null)
  const selectedChatUpdatedAtRef = useRef<number | null>(null)
  const recentChatCacheLimitRef = useRef(effectiveAppSettings.chat.recentChatCacheLimit)
  const recentChatCacheRef = useRef(new Map<string, RecentChatCacheEntry>())
  const recentlyViewedActiveChatPreviewsRef = useRef(new Map<string, ComparableChatPreview>())
  const chatOrderMutationsRef = useRef(new Map<string, number>())
  const projectOrderMutationRef = useRef(0)
  const expandedProjectGroupsBeforeDragRef = useRef<Set<string> | null>(null)
  const draggedProjectGroupKeyRef = useRef<string | null>(null)
  const projectDropInsertionIndexRef = useRef<number | null>(null)
  const projectCollapseFrameRef = useRef<number | null>(null)
  const changesCwdRef = useRef<string | null>(null)
  const changesContainerRef = useRef<AppContainerTarget | null>(null)
  const changeSourceRef = useRef(changeSource)
  const gitAvailableRef = useRef<boolean | null>(null)
  const selectedChatRef = useRef<ProviderChat | null>(selectedChat)
  const worktreeCreationCanceledRef = useRef(false)
  const worktreeBranchGenerationRef = useRef<{
    generationId: string
    providerId: ProviderId
  } | null>(null)
  const containerSelectionReadyRef = useRef(false)
  const initialChatCommitMarkersRef = useRef(chatCommitMarkers)
  const scopedCommitActivitiesRef =
    useRef<Record<string, ScopedCommitActivity>>(scopedCommitActivities)
  const startingScopedCommitActivitiesRef = useRef<Record<string, StartingScopedCommitActivity>>({})
  const loadingCwdNotesRef = useRef(new Set<string>())
  const loadingProjectIconsRef = useRef(new Set<string>())
  const messageBoxSelectionsRef = useRef(storedMessageBoxSelections)
  const messageBoxSelectionProviderRef = useRef<ProviderId>('codex')
  const modelManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.model))
  const reasoningManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.reasoningEffort))
  const approvalModeManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.approvalMode))
  const sandboxModeManuallySelectedRef = useRef(Boolean(storedMessageBoxSelection.sandboxMode))
  const approvalModeBeforeFullAccessRef = useRef<ProviderApprovalMode | null>(null)
  const collapsedFileTreeFoldersByCwdRef = useRef(new Map<string, Record<string, boolean>>())
  const lastOpenedFileTreeFolderByCwdRef = useRef(new Map<string, string>())
  const lastNonTerminalChangesPaneViewRef = useRef<Exclude<ChangesPaneView, 'terminal'>>('git')

  useLayoutEffect(() => {
    chatAtConversationBottomRef.current = chatAtConversationBottom
  }, [chatAtConversationBottom])

  const flushDeferredProviderResourceRefreshes = useCallback(async (): Promise<void> => {
    if (deferredProviderResourceRefreshRunningRef.current) return
    deferredProviderResourceRefreshRunningRef.current = true

    try {
      while (deferredProviderResourceRefreshesRef.current.size > 0) {
        const refreshes = Array.from(deferredProviderResourceRefreshesRef.current.values())
        deferredProviderResourceRefreshesRef.current.clear()
        await Promise.allSettled(
          refreshes.map(({ providerId, cwd, container }) =>
            Promise.allSettled([
              providerApi.getSkills(providerId, cwd, { container, forceRefresh: true }),
              providerApi.getApps(providerId, { container, forceRefresh: true })
            ])
          )
        )
        setProviderResourcesRevision((revision) => revision + 1)
        setProviderResourcesRefresh((refresh) => refresh + 1)
      }
    } finally {
      deferredProviderResourceRefreshRunningRef.current = false
    }
  }, [])

  const queueDeferredProviderResourceRefresh = useCallback(
    ({ providerId, cwd, container }: DeferredProviderResourceRefresh): void => {
      const key = `${providerId}:${cwd ?? ''}:${getContainerTargetKey(container)}`
      deferredProviderResourceRefreshesRef.current.set(key, { providerId, cwd, container })
      if (!settingsOpenRef.current) void flushDeferredProviderResourceRefreshes()
    },
    [flushDeferredProviderResourceRefreshes]
  )

  const scrollChatContentToBottom = useCallback((contentElement: HTMLElement): void => {
    const top = getScrollBottomTop(contentElement)
    if (Math.abs(contentElement.scrollTop - top) >= 0.5) {
      contentElement.scrollTop = top
    }
    if (!chatAtConversationBottomRef.current) {
      chatAtConversationBottomRef.current = true
      setChatAtConversationBottom(true)
    }
    chatAutoScrollTargetRef.current = {
      element: contentElement,
      top: contentElement.scrollTop
    }
    const chatKey = selectedChatKeyRef.current
    chatViewportAnchorRef.current = chatKey ? readChatScrollAnchor(contentElement, chatKey) : null
  }, [])

  const scrollPinnedChatMessageIntoView = useCallback((messageId: string): boolean => {
    const contentElement = contentRef.current
    if (!contentElement) return false

    const messageElement = Array.from(
      contentElement.querySelectorAll<HTMLElement>('[data-chat-message-id]')
    ).find((element) => element.dataset.chatMessageId === messageId)
    if (!messageElement) return false

    chatAutoScrollEnabledRef.current = false
    chatAutoScrollTargetRef.current = null
    chatUserScrollIntentRef.current = false
    setChatAtConversationBottom(false)

    pinnedMessageScrollCleanupRef.current?.()
    messageElement.classList.remove('chat-detail__message-block--pin-target')

    let settleTimeout: number | null = null
    let fallbackTimeout: number | null = null
    let highlightTimeout: number | null = null
    let stopped = false

    const stopWatchingScroll = (): void => {
      contentElement.removeEventListener('scroll', scheduleHighlight)
      if (settleTimeout !== null) window.clearTimeout(settleTimeout)
      if (fallbackTimeout !== null) window.clearTimeout(fallbackTimeout)
      settleTimeout = null
      fallbackTimeout = null
    }
    const cleanup = (): void => {
      stopped = true
      stopWatchingScroll()
      if (highlightTimeout !== null) window.clearTimeout(highlightTimeout)
      messageElement.classList.remove('chat-detail__message-block--pin-target')
      if (pinnedMessageScrollCleanupRef.current === cleanup) {
        pinnedMessageScrollCleanupRef.current = null
      }
    }
    const playHighlight = (): void => {
      if (stopped) return
      stopWatchingScroll()
      if (!messageElement.isConnected || contentRef.current !== contentElement) {
        cleanup()
        return
      }

      messageElement.classList.remove('chat-detail__message-block--pin-target')
      void messageElement.offsetWidth
      messageElement.classList.add('chat-detail__message-block--pin-target')
      highlightTimeout = window.setTimeout(() => {
        messageElement.classList.remove('chat-detail__message-block--pin-target')
        if (pinnedMessageScrollCleanupRef.current === cleanup) {
          pinnedMessageScrollCleanupRef.current = null
        }
      }, 1_200)
    }
    function scheduleHighlight(): void {
      if (stopped) return
      if (settleTimeout !== null) window.clearTimeout(settleTimeout)
      settleTimeout = window.setTimeout(playHighlight, 120)
    }

    pinnedMessageScrollCleanupRef.current = cleanup
    contentElement.addEventListener('scroll', scheduleHighlight, { passive: true })
    fallbackTimeout = window.setTimeout(playHighlight, 2_000)

    const contentRect = contentElement.getBoundingClientRect()
    const messageRect = messageElement.getBoundingClientRect()
    const centeredTop =
      contentElement.scrollTop +
      messageRect.top -
      contentRect.top -
      (contentElement.clientHeight - messageRect.height) / 2
    const targetTop = clamp(centeredTop, 0, getScrollBottomTop(contentElement))

    contentElement.scrollTo({ behavior: 'smooth', top: targetTop })
    if (Math.abs(contentElement.scrollTop - targetTop) <= 1) {
      window.requestAnimationFrame(playHighlight)
    }
    return true
  }, [])

  const scheduleChatAutoScroll = useCallback(
    (contentElement: HTMLElement | null = contentRef.current): void => {
      if (
        !contentElement ||
        !chatAutoScrollEnabledRef.current ||
        chatAutoScrollFrameRef.current !== null
      ) {
        return
      }

      chatAutoScrollTargetRef.current = {
        element: contentElement,
        top: contentElement.scrollTop
      }
      chatAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
        chatAutoScrollFrameRef.current = null
        if (contentRef.current !== contentElement || !chatAutoScrollEnabledRef.current) {
          return
        }

        scrollChatContentToBottom(contentElement)
      })
    },
    [scrollChatContentToBottom]
  )

  const handleChatDisclosureToggle = useCallback((): void => {
    const contentElement = contentRef.current
    const chatKey = selectedChatKeyRef.current
    if (!contentElement || !chatKey) return

    if (chatAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(chatAutoScrollFrameRef.current)
      chatAutoScrollFrameRef.current = null
    }
    chatAutoScrollEnabledRef.current = false
    chatAutoScrollTargetRef.current = null
    chatUserScrollIntentRef.current = true
    chatViewportAnchorRef.current = readChatScrollAnchor(contentElement, chatKey)
    if (chatUserScrollIntentFrameRef.current !== null) {
      window.cancelAnimationFrame(chatUserScrollIntentFrameRef.current)
    }
    chatUserScrollIntentFrameRef.current = window.requestAnimationFrame(() => {
      chatUserScrollIntentFrameRef.current = null
      chatUserScrollIntentRef.current = false
    })
  }, [])

  const resetChatSearch = useCallback((): void => {
    setChatSearchOpen(false)
    setChatSearchQuery('')
    setChatSearchMatchCount(0)
    setChatSearchActiveIndex(0)
    chatSearchMatchesRef.current = []
    chatSearchActiveIndexRef.current = 0
    chatSearchReturnFocusRef.current = null
    clearChatSearchHighlights()
  }, [])

  useEffect(() => {
    chatsRef.current = chats
  }, [chats])

  useEffect(() => {
    selectedChatRef.current = selectedChat
    selectedChatKeyRef.current = selectedChat ? getChatKey(selectedChat) : null
    selectedChatUpdatedAtRef.current = selectedChat?.updatedAt ?? null
  }, [selectedChat])

  useEffect(() => {
    chatDetailRef.current = chatDetail
  }, [chatDetail])

  useEffect(() => {
    chatTurnWindowRef.current = chatTurnWindow
  }, [chatTurnWindow])

  const clearSelectedChatIfUnavailableInSource = useCallback(
    (availableProviderIds: ProviderId[], container: AppContainerTarget | null): void => {
      const currentChat = selectedChatRef.current
      if (
        !currentChat ||
        availableProviderIds.includes(currentChat.providerId) ||
        !areContainerTargetsEqual(currentChat.container, container)
      ) {
        return
      }

      resetChatSearch()
      selectedChatRef.current = null
      selectedChatKeyRef.current = null
      selectedChatUpdatedAtRef.current = null
      chatDetailRef.current = null
      setSelectedChat(null)
      setChatDetail(null)
      setChatLoadState('ready')
      setSendState(sendInFlightRef.current ? 'sending' : 'idle')
      setEditingMessage(null)
      setNewChatOpen(true)
    },
    [resetChatSearch]
  )

  useEffect(() => {
    const limit = effectiveAppSettings.chat.recentChatCacheLimit
    recentChatCacheLimitRef.current = limit
    if (limit === 0) {
      recentChatCacheRef.current.clear()
      return
    }

    trimRecentChatCache(recentChatCacheRef.current, limit)
  }, [effectiveAppSettings.chat.recentChatCacheLimit])

  useEffect(() => {
    scopedCommitActivitiesRef.current = scopedCommitActivities
    writeStoredScopedCommitActivities(scopedCommitActivities)
  }, [scopedCommitActivities])

  useEffect(() => {
    writeStoredChatCommitMarkers(chatCommitMarkers)
  }, [chatCommitMarkers])

  useEffect(() => {
    writeStoredContinuedStoppedWorkingSteps(continuedStoppedWorkingStepsByChat)
  }, [continuedStoppedWorkingStepsByChat])

  useEffect(() => {
    let active = true
    const restoredActivities = Object.values(scopedCommitActivitiesRef.current)
    const restoredMarkerIds = new Set(restoredActivities.map((activity) => activity.markerId))
    const recoverablePendingMarkers = Object.values(initialChatCommitMarkersRef.current).filter(
      (marker) =>
        marker.status === 'pending' &&
        Boolean(marker.commitChatId) &&
        !restoredMarkerIds.has(marker.id)
    )
    const ambiguousTerminalMarkers = Object.values(initialChatCommitMarkersRef.current).filter(
      (marker) =>
        (marker.status === 'stopped' || marker.status === 'interrupted') &&
        Boolean(marker.commitChatId)
    )

    setChatCommitMarkers((currentMarkers) => {
      let changed = false
      const nextMarkers = { ...currentMarkers }

      Object.values(nextMarkers).forEach((marker) => {
        if (
          marker.status !== 'pending' ||
          marker.commitChatId ||
          restoredMarkerIds.has(marker.id)
        ) {
          return
        }

        changed = true
        nextMarkers[marker.id] = {
          ...marker,
          status: 'failed',
          finishedAt: Date.now()
        }
      })

      restoredActivities.forEach((activity) => {
        if (!activity.sourceChatId || nextMarkers[activity.markerId]) return

        changed = true
        nextMarkers[activity.markerId] = {
          id: activity.markerId,
          providerId: activity.providerId,
          sourceChatId: activity.sourceChatId,
          commitChatId: activity.chatId,
          commitAction: activity.commitAction,
          status: 'pending',
          afterItemId: null,
          startedAt: activity.startedAt,
          finishedAt: null
        }
      })

      return changed ? nextMarkers : currentMarkers
    })

    void Promise.all(
      restoredActivities.map(async (activity) => {
        try {
          const detail = await providerApi.getChat(activity.providerId, activity.chatId)
          if (!active) return

          const activityKey = getProviderChatKey(activity.providerId, activity.chatId)
          if (!isActiveChatStatus(detail.status)) {
            setChatCommitMarkers((currentMarkers) => {
              const marker = currentMarkers[activity.markerId]
              if (!marker || marker.status !== 'pending') return currentMarkers

              return {
                ...currentMarkers,
                [marker.id]: {
                  ...marker,
                  status: getRecoveredChatCommitMarkerTerminalStatus(detail),
                  afterItemId:
                    activity.chatId === activity.sourceChatId
                      ? getLastChatCommitMarkerAnchorId(detail.items, marker.afterItemId)
                      : marker.afterItemId,
                  finishedAt: Date.now()
                }
              }
            })
          }

          setScopedCommitActivities((currentActivities) => {
            const currentActivity = currentActivities[activityKey]
            if (!currentActivity) return currentActivities

            if (!isActiveChatStatus(detail.status)) {
              const nextActivities = { ...currentActivities }
              delete nextActivities[activityKey]
              return nextActivities
            }

            return {
              ...currentActivities,
              [activityKey]: {
                ...currentActivity,
                currentAction: getCommitActivityCurrentAction(detail, currentActivity.commitAction)
              }
            }
          })
        } catch {
          // Keep the restored activity if the provider cannot be reached yet.
        }
      })
    )

    void Promise.all(
      recoverablePendingMarkers.map(async (marker) => {
        const commitChatId = marker.commitChatId
        if (!commitChatId) return

        try {
          const detail = await providerApi.getChat(marker.providerId, commitChatId)
          if (!active) return

          if (!isActiveChatStatus(detail.status)) {
            setChatCommitMarkers((currentMarkers) => {
              const currentMarker = currentMarkers[marker.id]
              if (!currentMarker || currentMarker.status !== 'pending') return currentMarkers

              return {
                ...currentMarkers,
                [marker.id]: {
                  ...currentMarker,
                  status: getRecoveredChatCommitMarkerTerminalStatus(detail),
                  afterItemId:
                    commitChatId === marker.sourceChatId
                      ? getLastChatCommitMarkerAnchorId(detail.items, currentMarker.afterItemId)
                      : currentMarker.afterItemId,
                  finishedAt: Date.now()
                }
              }
            })
            return
          }

          const activityKey = getProviderChatKey(marker.providerId, commitChatId)
          const activity = {
            source: 'ai',
            providerId: marker.providerId,
            chatId: commitChatId,
            sourceChatId: marker.sourceChatId,
            markerId: marker.id,
            projectCwd: detail.projectCwd ?? detail.cwd,
            commitAction: marker.commitAction,
            currentAction: getCommitActivityCurrentAction(detail, marker.commitAction),
            startedAt: marker.startedAt
          } satisfies ScopedCommitActivity

          setScopedCommitActivities((currentActivities) => {
            const nextActivities = {
              ...currentActivities,
              [activityKey]: activity
            }
            scopedCommitActivitiesRef.current = nextActivities
            return nextActivities
          })
        } catch {
          // Keep the pending marker for a later provider update if recovery is temporarily offline.
        }
      })
    )

    void Promise.all(
      ambiguousTerminalMarkers.map(async (marker) => {
        const commitChatId = marker.commitChatId
        if (!commitChatId) return

        try {
          const detail = await providerApi.getChat(marker.providerId, commitChatId)
          if (!active) return

          const recoveredStatus = getChatCommitMarkerTerminalStatus(detail)
          if (recoveredStatus === 'stopped') return

          setChatCommitMarkers((currentMarkers) => {
            const currentMarker = currentMarkers[marker.id]
            if (
              !currentMarker ||
              (currentMarker.status !== 'stopped' && currentMarker.status !== 'interrupted')
            ) {
              return currentMarkers
            }

            return {
              ...currentMarkers,
              [currentMarker.id]: {
                ...currentMarker,
                status: recoveredStatus,
                finishedAt: Date.now()
              }
            }
          })
        } catch {
          // Preserve the stored marker when its backing provider chat is temporarily unavailable.
        }
      })
    )

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    writeStoredPinnedRecentChatReferences(pinnedRecentChatReferences)
  }, [pinnedRecentChatReferences])

  useEffect(() => {
    writeStoredRecentlyOpenedFiles(recentlyOpenedFilesByWorkspace)
  }, [recentlyOpenedFilesByWorkspace])

  useEffect(() => {
    writeStoredAppSettings(appSettings)
  }, [appSettings])

  useEffect(() => {
    writeStoredAppProjectSettings(projectSettingsByCwd)
  }, [projectSettingsByCwd])

  useEffect(() => {
    setThemePreference(effectiveAppSettings.appearance.theme)
  }, [effectiveAppSettings.appearance.theme])

  useEffect(() => {
    let active = true

    void appApi
      .getInstalledFontFamilies()
      .then((families) => {
        if (active) setInstalledFontFamilies(families)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setInstalledFontsLoaded(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void appApi.setWindowZoomLevel(effectiveAppSettings.appearance.zoomLevel).catch(() => {})
  }, [effectiveAppSettings.appearance.zoomLevel])

  const handleOpenBrowserRequest = useCallback(
    (request: BrowserOpenRequest): void => {
      if (!effectiveAppSettings.browser.enabled) {
        void appApi.handleExternalLink({ url: request.url, action: 'open' }).catch(() => {})
        return
      }

      setBrowserOpened(true)
      setBrowserOpenRequest(request)
      setChangesPaneView('browser')
    },
    [effectiveAppSettings.browser.enabled]
  )

  useEffect(() => browserApi.onOpenRequested(handleOpenBrowserRequest), [handleOpenBrowserRequest])

  useEffect(() => {
    if (effectiveAppSettings.browser.enabled) return

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setBrowserOpened(false)
      setBrowserOpenRequest(null)
      setChangesPaneView((currentView) => (currentView === 'browser' ? 'git' : currentView))
      if (lastNonTerminalChangesPaneViewRef.current === 'browser') {
        lastNonTerminalChangesPaneViewRef.current = 'git'
      }
    })

    return () => {
      active = false
    }
  }, [effectiveAppSettings.browser.enabled])

  useEffect(() => {
    const handleLinkClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return

      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor) return

      let url: URL
      try {
        url = new URL(anchor.href)
      } catch {
        return
      }
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return

      event.preventDefault()
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        handleOpenBrowserRequest({ id: crypto.randomUUID(), url: url.toString() })
        return
      }

      void appApi.handleExternalLink({ url: url.toString(), action: 'open' }).catch(() => {})
    }

    document.addEventListener('click', handleLinkClick)
    return () => document.removeEventListener('click', handleLinkClick)
  }, [handleOpenBrowserRequest])

  useLayoutEffect(() => {
    applyShadowPreference(effectiveAppSettings.performance.disableShadows)
  }, [effectiveAppSettings.performance.disableShadows])

  useLayoutEffect(() => {
    applyWindowControlAppearancePreferences(effectiveAppSettings.appearance)
  }, [effectiveAppSettings.appearance])

  useLayoutEffect(() => {
    applyFontAppearancePreferences(effectiveAppSettings.appearance)
  }, [effectiveAppSettings.appearance])

  useLayoutEffect(() => {
    settingsOpenRef.current = settingsOpen
    if (!settingsOpen) void flushDeferredProviderResourceRefreshes()
  }, [flushDeferredProviderResourceRefreshes, settingsOpen])

  useEffect(() => {
    if (!settingsOpen) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      setSettingsOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    queueMicrotask(() => settingsCloseButtonRef.current?.focus({ preventScroll: true }))

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen])

  useEffect(
    () => () => {
      if (chatAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(chatAutoScrollFrameRef.current)
      }
      if (chatUserScrollIntentFrameRef.current !== null) {
        window.cancelAnimationFrame(chatUserScrollIntentFrameRef.current)
      }
      pinnedMessageScrollCleanupRef.current?.()
    },
    []
  )

  useEffect(() => {
    const currentSelection: MessageBoxSelection = {
      agentMode,
      approvalMode,
      model,
      reasoningEffort,
      sandboxMode,
      serviceTier
    }
    const previousProviderId = messageBoxSelectionProviderRef.current

    if (previousProviderId !== configProviderId) {
      const nextSelections = {
        ...messageBoxSelectionsRef.current,
        [previousProviderId]: currentSelection
      }
      const nextSelection = nextSelections[configProviderId] ?? {}
      const fallbackModels = getFallbackModels(configProviderId)
      const nextModel =
        fallbackModels.find((candidateModel) => candidateModel.id === nextSelection.model) ??
        getDefaultModel(fallbackModels)

      messageBoxSelectionsRef.current = nextSelections
      messageBoxSelectionProviderRef.current = configProviderId
      modelManuallySelectedRef.current = Boolean(nextSelection.model)
      reasoningManuallySelectedRef.current = Boolean(nextSelection.reasoningEffort)
      approvalModeManuallySelectedRef.current = Boolean(nextSelection.approvalMode)
      sandboxModeManuallySelectedRef.current = Boolean(nextSelection.sandboxMode)
      approvalModeBeforeFullAccessRef.current = null

      setAgentMode(nextSelection.agentMode ?? 'interactive')
      setApprovalMode(nextSelection.approvalMode ?? fallbackDefaultApprovalMode)
      setSandboxMode(nextSelection.sandboxMode ?? fallbackDefaultSandboxMode)
      setModel(nextSelection.model ?? nextModel.id)
      setReasoningEffort(nextSelection.reasoningEffort ?? getDefaultReasoningEffort(nextModel))
      setServiceTier(nextSelection.serviceTier ?? null)
      writeStoredMessageBoxSelections(nextSelections)
      return
    }

    const nextSelections = {
      ...messageBoxSelectionsRef.current,
      [configProviderId]: currentSelection
    }
    messageBoxSelectionsRef.current = nextSelections
    writeStoredMessageBoxSelections(nextSelections)
  }, [agentMode, approvalMode, configProviderId, model, reasoningEffort, sandboxMode, serviceTier])

  useEffect(() => {
    if (sandboxMode !== 'danger-full-access' || approvalMode === 'never') return

    approvalModeBeforeFullAccessRef.current = approvalMode
    queueMicrotask(() => setApprovalMode('never'))
  }, [approvalMode, sandboxMode])

  useEffect(() => {
    let active = true

    appApi
      .getWindowState()
      .then((nextWindowState) => {
        if (active) setWindowState(nextWindowState)
      })
      .catch(() => {})

    const unsubscribe = appApi.onWindowStateUpdated((nextWindowState) => {
      setWindowState(nextWindowState)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    writeStoredProviderUpdatePreferences(providerUpdatePreferences)
  }, [providerUpdatePreferences])

  useEffect(() => {
    if (!containerSelectionReady) return

    writeStoredContainerSelection(newSessionContainer)
  }, [containerSelectionReady, newSessionContainer])

  useEffect(() => {
    let active = true

    Promise.all([
      appApi.getContainerSuggestions().catch(() => [] satisfies AppContainerSuggestion[]),
      appApi.getSshEnvironments()
    ])
      .then(([suggestions, environments]) => {
        if (!active) return

        const currentSuggestion = suggestions.find((suggestion) => suggestion.current)
        const currentSource = currentSuggestion
          ? getContainerTargetFromSuggestion(currentSuggestion)
          : ({ kind: 'host' } satisfies AppContainerTarget)

        setContainerSuggestions(suggestions)
        setSshEnvironments(environments)
        setNewSessionContainer((currentContainer) => {
          if (!containerSelectionReadyRef.current) {
            const initialContainer = storedContainerSelection ?? currentSource
            return isContainerTargetAvailable(initialContainer, suggestions, environments)
              ? initialContainer
              : currentSource
          }

          return isContainerTargetAvailable(currentContainer, suggestions, environments)
            ? currentContainer
            : currentSource
        })
        containerSelectionReadyRef.current = true
        setContainerSelectionReady(true)
      })
      .catch(() => {
        if (!active) return

        setContainerSuggestions([])
        setSshEnvironments([])
        if (!containerSelectionReadyRef.current) {
          setNewSessionContainer(storedContainerSelection ?? { kind: 'host' })
        } else {
          setNewSessionContainer({ kind: 'host' })
        }
        containerSelectionReadyRef.current = true
        setContainerSelectionReady(true)
      })

    return () => {
      active = false
    }
  }, [storedContainerSelection])

  useEffect(() => {
    let active = true
    const environmentId = newSessionSshEnvironmentId

    if (!environmentId) {
      queueMicrotask(() => {
        if (!active) return
        setRemoteContainerSuggestions([])
        setRemoteContainerSuggestionsLoading(false)
        setRemoteContainerSuggestionsError(null)
      })
      return () => {
        active = false
      }
    }

    const remoteEnvironment = {
      kind: 'container',
      tool: 'ssh',
      name: environmentId,
      runtime: { kind: 'host' }
    } satisfies AppContainerTarget

    queueMicrotask(() => {
      if (!active) return
      setRemoteContainerSuggestions([])
      setRemoteContainerSuggestionsLoading(true)
      setRemoteContainerSuggestionsError(null)
    })

    appApi
      .getContainerSuggestions({ container: remoteEnvironment })
      .then((suggestions) => {
        if (!active) return

        setRemoteContainerSuggestions(suggestions)
        setRemoteContainerSuggestionsError(null)
        setNewSessionContainer((currentContainer) => {
          if (
            currentContainer.kind !== 'container' ||
            currentContainer.tool !== 'ssh' ||
            currentContainer.name !== environmentId ||
            currentContainer.runtime?.kind !== 'container'
          ) {
            return currentContainer
          }

          const runtime = currentContainer.runtime
          return suggestions.some(
            (suggestion) => suggestion.tool === runtime.tool && suggestion.name === runtime.name
          )
            ? currentContainer
            : { ...currentContainer, runtime: { kind: 'host' } }
        })
      })
      .catch((error) => {
        if (!active) return
        setRemoteContainerSuggestions([])
        setRemoteContainerSuggestionsError(
          getErrorMessage(error, 'Unable to check containers over SSH.')
        )
      })
      .finally(() => {
        if (active) setRemoteContainerSuggestionsLoading(false)
      })

    return () => {
      active = false
    }
  }, [newSessionSshEnvironmentId])

  useEffect(() => {
    let active = true
    const container = normalizeContainerTarget(newSessionContainer)
    const containerKey = getContainerTargetKey(container)

    queueMicrotask(() => {
      if (!active) return
      setNewSessionSourceAvailability((currentAvailability) =>
        currentAvailability?.containerKey === containerKey ? currentAvailability : null
      )
    })

    appApi
      .getSourceAvailability({ container })
      .then((availability) => {
        if (!active) return

        setNewSessionSourceAvailability({ containerKey, availability, error: null })
      })
      .catch((error) => {
        if (!active) return

        setNewSessionSourceAvailability({
          containerKey,
          availability: {
            gitAvailable: false,
            providers: providerIds.map((providerId) => ({ providerId, available: false }))
          },
          error: getErrorMessage(error, 'Unable to check source availability.')
        })
      })

    return () => {
      active = false
    }
  }, [newSessionContainer, newSessionContainerKey])

  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'providers') return

    let active = true
    const providerId = newSessionProvider
    const container = normalizeContainerTarget(newSessionContainer)
    queueMicrotask(() => {
      if (!active) return
      setSettingsProviderAccounts(null)
      setProviderAccountsError(null)
      setProviderAccountsLoadState('loading')
    })

    providerApi
      .getAccounts(providerId, { container })
      .then((configuration) => {
        if (!active) return
        setSettingsProviderAccounts(configuration)
        setProviderAccountsError(null)
        setProviderAccountsLoadState('ready')
      })
      .catch((error) => {
        if (!active) return
        setSettingsProviderAccounts(null)
        setProviderAccountsError(
          getErrorMessage(error, 'Unable to inspect provider accounts in this environment.')
        )
        setProviderAccountsLoadState('ready')
      })

    return () => {
      active = false
    }
  }, [
    newSessionContainer,
    newSessionContainerKey,
    newSessionProvider,
    providerAccountsRefresh,
    settingsOpen,
    settingsTab
  ])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setAccountDialogOpen(false)
    })
    return () => {
      active = false
    }
  }, [newSessionContainerKey, newSessionProvider])

  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'providers') return

    let active = true
    if (!newSessionSourceAvailabilityReady) {
      queueMicrotask(() => {
        if (!active) return
        setSettingsProviderSkills([])
        setSettingsProviderApps([])
        setProviderResourcesError(null)
        setProviderResourcesLoadState('loading')
      })
      return () => {
        active = false
      }
    }

    if (newSessionAvailableProviderIds.length === 0) {
      queueMicrotask(() => {
        if (!active) return
        setSettingsProviderSkills([])
        setSettingsProviderApps([])
        setProviderResourcesError('No providers are available in this environment.')
        setProviderResourcesLoadState('ready')
      })
      return () => {
        active = false
      }
    }

    if (!newSessionProviderAvailable) {
      queueMicrotask(() => {
        if (!active) return
        setSettingsProviderSkills([])
        setSettingsProviderApps([])
        setProviderResourcesError(null)
        setProviderResourcesLoadState('loading')
      })
      return () => {
        active = false
      }
    }

    const providerId = newSessionProvider
    const container = normalizeContainerTarget(newSessionContainer)
    queueMicrotask(() => {
      if (!active) return
      setSettingsProviderSkills([])
      setSettingsProviderApps([])
      setProviderResourcesError(null)
      setProviderResourcesLoadState('loading')
    })

    void Promise.allSettled([
      providerApi.getSkills(providerId, settingsProjectCwd, { container }),
      providerApi.getApps(providerId, { container })
    ]).then(([skills, apps]) => {
      if (!active) return

      setSettingsProviderSkills(
        mergeSettingsProviderSkills([
          {
            providerId,
            skills: skills.status === 'fulfilled' ? skills.value : []
          }
        ])
      )
      setSettingsProviderApps(
        (apps.status === 'fulfilled' ? apps.value : [])
          .map((app) => ({ providerId, app }))
          .sort((first, second) => first.app.name.localeCompare(second.app.name))
      )
      setProviderResourcesError(
        skills.status === 'rejected' && apps.status === 'rejected'
          ? 'Unable to inspect provider resources in this environment.'
          : null
      )
      setProviderResourcesLoadState('ready')
    })

    return () => {
      active = false
    }
  }, [
    newSessionAvailableProviderIds,
    newSessionContainer,
    newSessionContainerKey,
    newSessionProvider,
    newSessionProviderAvailable,
    newSessionSourceAvailabilityReady,
    providerResourcesRefresh,
    settingsOpen,
    settingsProjectCwd,
    settingsTab
  ])

  useEffect(() => {
    if (newSessionAvailableProviderIds.length === 0 || newSessionProviderAvailable) return

    let active = true
    queueMicrotask(() => {
      if (active) setNewSessionProvider(newSessionAvailableProviderIds[0]!)
    })

    return () => {
      active = false
    }
  }, [newSessionAvailableProviderIds, newSessionProviderAvailable])

  useEffect(() => {
    const queueProviderUpdateClear = (): void => {
      queueMicrotask(() => {
        setProviderUpdateSuggestion(null)
        setProviderUpdateError(null)
      })
    }

    if (selectedChat || !newChatOpen || !newSessionProviderAvailable) {
      queueProviderUpdateClear()
      return undefined
    }

    const providerId = newSessionProvider
    const container = normalizeContainerTarget(newSessionContainer)
    const preference = getProviderUpdatePreference(providerUpdatePreferences, providerId)
    if (preference.neverSuggest) {
      queueProviderUpdateClear()
      return undefined
    }

    let active = true

    queueMicrotask(() => {
      if (!active) return

      setProviderUpdateSuggestion((currentSuggestion) =>
        currentSuggestion?.providerId === providerId ? currentSuggestion : null
      )
      setProviderUpdateError(null)
    })

    providerApi
      .getUpdateAvailability(providerId, { container })
      .then((availability) => {
        if (!active) return

        setProviderUpdateSuggestion(
          availability &&
            shouldSuggestProviderUpdate(providerUpdatePreferences, providerId, availability)
            ? { ...availability, providerId }
            : null
        )
      })
      .catch(() => {
        if (active) setProviderUpdateSuggestion(null)
      })

    return () => {
      active = false
    }
  }, [
    newChatOpen,
    newSessionContainer,
    newSessionProvider,
    newSessionProviderAvailable,
    providerUpdatePreferences,
    selectedChat
  ])

  useEffect(() => {
    let active = true

    const loadInitialChats = async (): Promise<void> => {
      if (!newSessionSourceAvailabilityReady) return

      const container = normalizeContainerTarget(newSessionContainer)
      if (newSessionAvailableProviderIds.length === 0) {
        setChats([])
        clearSelectedChatIfUnavailableInSource([], container)
        setLoadState('ready')
        return
      }

      const availableProviderIds = new Set(newSessionAvailableProviderIds)
      const initialChatKeysByProvider = new Map(
        newSessionAvailableProviderIds.map((providerId) => [
          providerId,
          new Set(
            chatsRef.current
              .filter(
                (chat) =>
                  chat.providerId === providerId &&
                  areContainerTargetsEqual(chat.container, container)
              )
              .map(getChatKey)
          )
        ])
      )
      setChats((currentChats) =>
        currentChats.filter(
          (chat) =>
            availableProviderIds.has(chat.providerId) &&
            areContainerTargetsEqual(chat.container, container)
        )
      )
      clearSelectedChatIfUnavailableInSource(newSessionAvailableProviderIds, container)
      setLoadState('loading')

      let settledProviderCount = 0
      let loadedProviderCount = 0
      const markProviderSettled = (): void => {
        settledProviderCount += 1
        if (
          settledProviderCount === newSessionAvailableProviderIds.length &&
          loadedProviderCount === 0
        ) {
          setLoadState('error')
        }
      }

      newSessionAvailableProviderIds.forEach((providerId) => {
        const loadProviderChats = async (): Promise<void> => {
          let cursor: string | null = null
          let firstPage = true
          const loadedProviderChatKeys = new Set<string>()
          const seenCursors = new Set<string>()

          do {
            const page = await providerApi.getChats(providerId, {
              container,
              cursor,
              limit: chatListFetchPageSize
            })
            if (!active) return

            if (firstPage) loadedProviderCount += 1
            page.chats.forEach((chat) => loadedProviderChatKeys.add(getChatKey(chat)))
            // Keep the previous snapshot mounted while later pages are still loading.
            setChats((currentChats) => mergeChats(currentChats, page.chats))
            setLoadState('ready')

            firstPage = false
            cursor = page.nextCursor
            if (cursor && seenCursors.has(cursor)) break
            if (cursor) seenCursors.add(cursor)
          } while (cursor)

          const initialProviderChatKeys = initialChatKeysByProvider.get(providerId) ?? new Set()
          // Once every page is present, discard only stale entries from the original snapshot.
          setChats((currentChats) =>
            mergeChats(
              currentChats.filter(
                (chat) =>
                  chat.providerId !== providerId ||
                  !initialProviderChatKeys.has(getChatKey(chat)) ||
                  loadedProviderChatKeys.has(getChatKey(chat))
              )
            )
          )
        }

        void loadProviderChats()
          .catch(() => {
            // Other providers should still populate the sidebar.
          })
          .finally(() => {
            if (active) markProviderSettled()
          })
      })
    }

    void loadInitialChats()

    return () => {
      active = false
    }
  }, [
    clearSelectedChatIfUnavailableInSource,
    newSessionAvailableProviderIds,
    newSessionContainer,
    newSessionSourceAvailabilityReady
  ])

  useEffect(() => {
    let active = true

    appApi
      .getProjects()
      .then((storedProjects) => {
        if (active) setProjects(mergeProjects(storedProjects))
      })
      .catch(() => {
        if (active) setProjects([])
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    if (configProviderId !== 'copilot' || !configProviderModelsReady) {
      queueMicrotask(() => {
        if (!active) return
        setAgentModes([])
        setAgentModesLoading(false)
      })

      return () => {
        active = false
      }
    }

    const container = normalizeContainerTarget(configProviderContainerRef.current)
    queueMicrotask(() => {
      if (!active) return
      setAgentModes([])
      setAgentModesLoading(true)
    })

    providerApi
      .getAgentModes(configProviderId, { container })
      .then((nextAgentModes) => {
        if (!active) return
        setAgentModes(nextAgentModes)
        setAgentModesLoading(false)
      })
      .catch(() => {
        if (!active) return
        setAgentModes([])
        setAgentModesLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    configProviderContainerKey,
    configProviderId,
    configProviderModelsReady,
    providerModelsRevision
  ])

  useEffect(() => {
    if (agentModesLoading || agentModes.length === 0) return

    let active = true
    queueMicrotask(() => {
      if (!active) return
      setAgentMode((currentMode) => {
        if (agentModes.some((mode) => mode.id === currentMode)) return currentMode
        return agentModes.find((mode) => mode.isDefault)?.id ?? agentModes[0]!.id
      })
    })

    return () => {
      active = false
    }
  }, [agentModes, agentModesLoading])

  useEffect(() => {
    let active = true

    providerApi
      .getApprovalModes(configProviderId)
      .then((nextApprovalModes) => {
        if (!active || nextApprovalModes.length === 0) return

        setApprovalModes(nextApprovalModes)
      })
      .catch(() => {
        if (active) setApprovalModes(fallbackProviderApprovalModes)
      })

    return () => {
      active = false
    }
  }, [configProviderId])

  useEffect(() => {
    if (approvalModes.length === 0) return

    const defaultApprovalMode = getDefaultApprovalMode(approvalModes)

    setApprovalMode((currentApprovalMode) => {
      const currentApprovalModeExists = approvalModes.some(
        (mode) => mode.id === currentApprovalMode
      )

      if (!currentApprovalModeExists) return defaultApprovalMode
      if (
        !approvalModeManuallySelectedRef.current &&
        currentApprovalMode === fallbackDefaultApprovalMode
      ) {
        return defaultApprovalMode
      }

      return currentApprovalMode
    })
  }, [approvalModes])

  useEffect(() => {
    let active = true

    providerApi
      .getSandboxModes(configProviderId)
      .then((nextSandboxModes) => {
        if (!active || nextSandboxModes.length === 0) return

        setSandboxModes(nextSandboxModes)
      })
      .catch(() => {
        if (active) setSandboxModes(fallbackProviderSandboxModes)
      })

    return () => {
      active = false
    }
  }, [configProviderId])

  useEffect(() => {
    if (sandboxModes.length === 0) return

    const defaultSandboxMode = getDefaultSandboxMode(sandboxModes)

    setSandboxMode((currentSandboxMode) => {
      const currentSandboxModeExists = sandboxModes.some((mode) => mode.id === currentSandboxMode)

      if (!currentSandboxModeExists) return defaultSandboxMode
      if (
        !sandboxModeManuallySelectedRef.current &&
        currentSandboxMode === fallbackDefaultSandboxMode
      ) {
        return defaultSandboxMode
      }

      return currentSandboxMode
    })
  }, [sandboxModes])

  useEffect(() => {
    let active = true
    const fallbackModels = getFallbackModels(configProviderId)
    const cachedModels = providerModelCatalogCacheRef.current.get(configProviderModelCatalogKey)

    if (!configProviderModelsReady) {
      queueMicrotask(() => {
        if (!active) return
        if (cachedModels) {
          setModels(cachedModels)
          setDisplayedModelCatalogKey(configProviderModelCatalogKey)
        } else {
          setDisplayedModelCatalogKey((currentKey) => {
            if (currentKey === configProviderModelCatalogKey) return currentKey
            setModels([])
            return null
          })
        }
        setModelsLoading(false)
      })

      return () => {
        active = false
      }
    }

    const container = normalizeContainerTarget(configProviderContainerRef.current)
    queueMicrotask(() => {
      if (!active) return
      if (cachedModels) {
        setModels(cachedModels)
        setModelsLoading(false)
        setDisplayedModelCatalogKey(configProviderModelCatalogKey)
      } else {
        setModels(configProviderId === 'claude' ? [] : fallbackModels)
        setModelsLoading(true)
        setDisplayedModelCatalogKey(null)
      }
    })

    providerApi
      .getModels(configProviderId, { container })
      .then((nextModels) => {
        if (!active) return

        const resolvedModels = nextModels.length > 0 ? nextModels : fallbackModels
        providerModelCatalogCacheRef.current.set(configProviderModelCatalogKey, resolvedModels)
        setDisplayedModelCatalogKey(configProviderModelCatalogKey)
        setModels(resolvedModels)
        setModelsLoading(false)
      })
      .catch(() => {
        if (!active) return
        const resolvedModels = cachedModels ?? fallbackModels
        providerModelCatalogCacheRef.current.set(configProviderModelCatalogKey, resolvedModels)
        setDisplayedModelCatalogKey(configProviderModelCatalogKey)
        setModels(resolvedModels)
        setModelsLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    configProviderContainerKey,
    configProviderId,
    configProviderModelCatalogKey,
    configProviderModelsReady,
    providerModelsRevision
  ])

  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'git' || gitSettingsUsesConfigProviderModels) return

    let active = true
    const fallbackModels = getFallbackModels(newSessionProvider)
    const cachedModels = providerModelCatalogCacheRef.current.get(gitSettingsModelCatalogKey)

    if (!gitSettingsModelsReady) {
      queueMicrotask(() => {
        if (!active) return
        setGitSettingsModels(cachedModels ?? [])
        setGitSettingsModelsLoading(false)
        setDisplayedGitSettingsModelCatalogKey(cachedModels ? gitSettingsModelCatalogKey : null)
      })

      return () => {
        active = false
      }
    }

    const container = normalizeContainerTarget(newSessionContainer)
    queueMicrotask(() => {
      if (!active) return
      if (cachedModels) {
        setGitSettingsModels(cachedModels)
        setGitSettingsModelsLoading(false)
        setDisplayedGitSettingsModelCatalogKey(gitSettingsModelCatalogKey)
      } else {
        setGitSettingsModels(newSessionProvider === 'claude' ? [] : fallbackModels)
        setGitSettingsModelsLoading(true)
        setDisplayedGitSettingsModelCatalogKey(gitSettingsModelCatalogKey)
      }
    })

    providerApi
      .getModels(newSessionProvider, { container })
      .then((nextModels) => {
        if (!active) return

        const resolvedModels = nextModels.length > 0 ? nextModels : fallbackModels
        providerModelCatalogCacheRef.current.set(gitSettingsModelCatalogKey, resolvedModels)
        setDisplayedGitSettingsModelCatalogKey(gitSettingsModelCatalogKey)
        setGitSettingsModels(resolvedModels)
        setGitSettingsModelsLoading(false)
      })
      .catch(() => {
        if (!active) return
        const resolvedModels = cachedModels ?? fallbackModels
        providerModelCatalogCacheRef.current.set(gitSettingsModelCatalogKey, resolvedModels)
        setDisplayedGitSettingsModelCatalogKey(gitSettingsModelCatalogKey)
        setGitSettingsModels(resolvedModels)
        setGitSettingsModelsLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    gitSettingsModelCatalogKey,
    gitSettingsModelsReady,
    gitSettingsUsesConfigProviderModels,
    newSessionContainer,
    newSessionProvider,
    providerModelsRevision,
    settingsOpen,
    settingsTab
  ])

  useEffect(() => {
    const catalog = {
      activeKey: configProviderModelCatalogKey,
      displayedKey: displayedModelCatalogKey,
      loading: modelsLoading
    }

    setModel((currentModel) => {
      const selection = reconcileModelSelection(
        models,
        { model: currentModel, manuallySelected: modelManuallySelectedRef.current },
        fallbackInitialModel.id,
        catalog
      )
      modelManuallySelectedRef.current = selection.manuallySelected
      return selection.model
    })
  }, [configProviderModelCatalogKey, displayedModelCatalogKey, models, modelsLoading])

  useEffect(() => {
    const selectedModel = models.find((nextModel) => nextModel.id === model)
    const catalog = {
      activeKey: configProviderModelCatalogKey,
      displayedKey: displayedModelCatalogKey,
      loading: modelsLoading
    }

    setReasoningEffort((currentReasoningEffort) => {
      const selection = reconcileReasoningSelection(
        selectedModel,
        {
          reasoningEffort: currentReasoningEffort,
          manuallySelected: reasoningManuallySelectedRef.current
        },
        catalog
      )
      reasoningManuallySelectedRef.current = selection.manuallySelected
      return selection.reasoningEffort
    })

    if (catalog.loading || catalog.displayedKey !== catalog.activeKey || !selectedModel) return
    setServiceTier((currentServiceTier) =>
      modelSupportsServiceTier(selectedModel, currentServiceTier)
        ? currentServiceTier
        : (selectedModel.defaultServiceTier ?? null)
    )
  }, [
    effectiveAppSettings.chat.forceModel,
    effectiveAppSettings.chat.forceReasoning,
    effectiveAppSettings.chat.forceSpeed,
    configProviderModelCatalogKey,
    displayedModelCatalogKey,
    model,
    models,
    modelsLoading
  ])

  const removeRecentChatCacheEntry = useCallback((providerId: ProviderId, chatId: string): void => {
    recentChatCacheRef.current.delete(getProviderChatKey(providerId, chatId))
  }, [])

  const cacheRecentChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      updatedAt: number,
      force = false
    ): void => {
      const cache = recentChatCacheRef.current
      const limit = recentChatCacheLimitRef.current
      const cacheKey = getProviderChatKey(providerId, detail.id)

      if (limit === 0 || detail.done || detail.purpose === 'commit') {
        cache.delete(cacheKey)
        return
      }
      if (!force && selectedChatKeyRef.current !== cacheKey && !cache.has(cacheKey)) return

      cache.delete(cacheKey)
      cache.set(cacheKey, { detail, updatedAt })
      trimRecentChatCache(cache, limit)
    },
    []
  )

  const getRecentCachedChatDetail = useCallback((chat: ProviderChat): ProviderChatDetail | null => {
    if (recentChatCacheLimitRef.current === 0 || chat.done) return null

    const cache = recentChatCacheRef.current
    const cacheKey = getChatKey(chat)
    const entry = cache.get(cacheKey)
    if (!entry) return null

    if (
      entry.detail.done ||
      entry.detail.purpose === 'commit' ||
      entry.updatedAt < chat.updatedAt ||
      entry.detail.status !== chat.status
    ) {
      cache.delete(cacheKey)
      return null
    }

    cache.delete(cacheKey)
    cache.set(cacheKey, entry)
    return entry.detail
  }, [])

  const applyChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      options: ApplyChatDetailOptions = {}
    ): void => {
      const updatedAt = Date.now()
      const detailKey = getProviderChatKey(providerId, detail.id)
      const currentDetail = chatDetailRef.current
      const appliedDetail =
        shouldPreserveOptimisticTurnUntilUserMessage(providerId) &&
        isActiveChatStatus(detail.status) &&
        currentDetail?.id === detail.id &&
        (options.select || selectedChatKeyRef.current === detailKey)
          ? preserveOptimisticChatDetail(currentDetail, detail)
          : detail
      if (options.select || selectedChatKeyRef.current === detailKey) {
        chatDetailRef.current = appliedDetail
        selectedChatUpdatedAtRef.current = options.select
          ? updatedAt
          : Math.max(selectedChatUpdatedAtRef.current ?? 0, updatedAt)
      }
      cacheRecentChatDetail(providerId, appliedDetail, updatedAt, options.select)

      const hiddenCommit = appliedDetail.purpose === 'commit'
      if (hiddenCommit) {
        setChats((currentChats) =>
          currentChats.filter(
            (chat) => chat.providerId !== providerId || chat.id !== appliedDetail.id
          )
        )
        if (!options.select && selectedChatKeyRef.current !== detailKey) return
      }

      if (options.select) {
        resetChatSearch()
        setChatDetail(appliedDetail)
        setChatLoadState('ready')
        setSelectedChat(getChatFromDetail(providerId, appliedDetail, null, updatedAt))
        setNewChatOpen(false)
      } else {
        setChatDetail((renderedDetail) =>
          renderedDetail?.id === appliedDetail.id ? appliedDetail : renderedDetail
        )
        setSelectedChat((currentChat) =>
          currentChat?.providerId === providerId && currentChat.id === appliedDetail.id
            ? getChatFromDetail(providerId, appliedDetail, currentChat, updatedAt)
            : currentChat
        )
      }

      if (hiddenCommit) return

      setChats((currentChats) => {
        const existingChat =
          currentChats.find(
            (chat) => chat.providerId === providerId && chat.id === appliedDetail.id
          ) ?? null
        const nextChat = getChatFromDetail(providerId, appliedDetail, existingChat, updatedAt)

        return mergeChats(currentChats, [nextChat])
      })
    },
    [cacheRecentChatDetail, resetChatSearch]
  )

  const applyChatSummary = useCallback(
    (providerId: ProviderId, summary: ProviderChatUpdateSummary, turnCompleted: boolean): void => {
      removeRecentChatCacheEntry(providerId, summary.id)

      const summaryKey = getProviderChatKey(providerId, summary.id)
      const hiddenCommit = summary.purpose === 'commit'
      if (hiddenCommit) {
        setChats((currentChats) =>
          currentChats.filter((chat) => chat.providerId !== providerId || chat.id !== summary.id)
        )
        if (selectedChatKeyRef.current !== summaryKey) return
      }

      if (selectedChatKeyRef.current === summaryKey) {
        selectedChatUpdatedAtRef.current = Math.max(
          selectedChatUpdatedAtRef.current ?? 0,
          summary.updatedAt
        )
      }
      if (selectedChatKeyRef.current === summaryKey && chatDetailRef.current?.id === summary.id) {
        chatDetailRef.current = getChatDetailFromUpdateSummary(chatDetailRef.current, summary)
        setChatDetail((currentDetail) =>
          currentDetail?.id === summary.id
            ? getChatDetailFromUpdateSummary(currentDetail, summary)
            : currentDetail
        )
      }

      setSelectedChat((currentChat) => {
        if (currentChat?.providerId !== providerId || currentChat.id !== summary.id) {
          return currentChat
        }

        const nextChat = getChatFromUpdateSummary(providerId, summary, currentChat, turnCompleted)
        return areChatsEqual(currentChat, nextChat) ? currentChat : nextChat
      })
      if (hiddenCommit) return

      setChats((currentChats) => {
        const existingChat =
          currentChats.find((chat) => chat.providerId === providerId && chat.id === summary.id) ??
          null
        const nextChat = getChatFromUpdateSummary(providerId, summary, existingChat, turnCompleted)
        if (existingChat && areChatsEqual(existingChat, nextChat)) return currentChats

        return mergeChats(currentChats, [nextChat])
      })
    },
    [removeRecentChatCacheEntry]
  )

  const showNewChatView = useCallback(
    (projectCwd?: string | null, container?: AppContainerTarget | null): void => {
      resetChatSearch()
      setCommitChatReturnTarget(null)
      chatDetailRef.current = null
      setSelectedChat(null)
      setChatDetail(null)
      setChatLoadState('ready')
      setSendState(sendInFlightRef.current ? 'sending' : 'idle')
      setEditingMessage(null)
      setSearchOpen(false)
      setSearchQuery('')
      if (projectCwd !== undefined) setNewSessionCwd(projectCwd)
      if (container !== undefined) {
        const normalizedContainer = normalizeContainerTarget(container)
        setNewSessionContainer(
          isContainerTargetAvailable(normalizedContainer, containerSuggestions, sshEnvironments)
            ? normalizedContainer
            : { kind: 'host' }
        )
      }
      setNewChatOpen(true)
    },
    [containerSuggestions, resetChatSearch, sshEnvironments]
  )

  const applyChatMetadata = useCallback((metadataList: ProviderChatMetadata[]): void => {
    const metadataById = new Map(metadataList.map((metadata) => [metadata.id, metadata]))
    const recentChatCache = recentChatCacheRef.current

    for (const [cacheKey, entry] of recentChatCache) {
      const metadata = metadataById.get(entry.detail.id)
      if (!metadata) continue

      if (metadata.done || metadata.purpose === 'commit') {
        recentChatCache.delete(cacheKey)
        continue
      }

      recentChatCache.set(cacheKey, {
        ...entry,
        detail: mergeChatMetadata(entry.detail, metadata)
      })
    }

    setChats((currentChats) =>
      currentChats.map((chat) => {
        const metadata = metadataById.get(chat.id)
        return metadata ? mergeChatMetadata(chat, metadata) : chat
      })
    )
    setSelectedChat((currentChat) => {
      if (!currentChat) return currentChat

      const metadata = metadataById.get(currentChat.id)
      return metadata ? mergeChatMetadata(currentChat, metadata) : currentChat
    })
    setChatDetail((currentDetail) => {
      if (!currentDetail) return currentDetail

      const metadata = metadataById.get(currentDetail.id)
      return metadata ? mergeChatMetadata(currentDetail, metadata) : currentDetail
    })
  }, [])

  const applySeenUpdatedAt = useCallback(
    (providerId: ProviderId, chatId: string, seenUpdatedAt: number): void => {
      const mergeSeenUpdatedAt = (currentSeenUpdatedAt: number | null): number =>
        currentSeenUpdatedAt == null ? seenUpdatedAt : Math.max(currentSeenUpdatedAt, seenUpdatedAt)
      const cacheKey = getProviderChatKey(providerId, chatId)
      const cacheEntry = recentChatCacheRef.current.get(cacheKey)
      if (cacheEntry) {
        recentChatCacheRef.current.set(cacheKey, {
          ...cacheEntry,
          detail: {
            ...cacheEntry.detail,
            seenUpdatedAt: mergeSeenUpdatedAt(cacheEntry.detail.seenUpdatedAt)
          }
        })
      }

      setChats((currentChats) =>
        currentChats.map((chat) =>
          chat.providerId === providerId && chat.id === chatId
            ? { ...chat, seenUpdatedAt: mergeSeenUpdatedAt(chat.seenUpdatedAt) }
            : chat
        )
      )
      setSelectedChat((currentChat) =>
        currentChat?.providerId === providerId && currentChat.id === chatId
          ? { ...currentChat, seenUpdatedAt: mergeSeenUpdatedAt(currentChat.seenUpdatedAt) }
          : currentChat
      )
      setChatDetail((currentDetail) =>
        currentDetail?.id === chatId
          ? { ...currentDetail, seenUpdatedAt: mergeSeenUpdatedAt(currentDetail.seenUpdatedAt) }
          : currentDetail
      )
    },
    []
  )

  const markChatSeenAt = useCallback(
    (providerId: ProviderId, chatId: string, seenUpdatedAt: number): void => {
      applySeenUpdatedAt(providerId, chatId, seenUpdatedAt)

      void providerApi
        .markChatSeen(providerId, chatId, seenUpdatedAt)
        .then((metadata) => applyChatMetadata([metadata]))
        .catch(() => {
          // Keep the optimistic in-memory seen state if persistence fails.
        })
    },
    [applyChatMetadata, applySeenUpdatedAt]
  )

  const markSelectedChatSeen = useCallback(
    (rememberPendingCompletion = false): void => {
      if (!selectedChat) return

      const chatKey = getChatKey(selectedChat)
      const cacheEntry = recentChatCacheRef.current.get(chatKey)
      if (rememberPendingCompletion && isActiveChatStatus(selectedChat.status)) {
        const selectedDetail = chatDetailRef.current
        const lastVisibleMessage =
          selectedDetail?.id === selectedChat.id
            ? selectedDetail.items.findLast((item) => item.type === 'message')
            : null
        const viewedPreview = getComparableChatPreview(
          lastVisibleMessage?.role === 'assistant' ? lastVisibleMessage.content : null
        )
        if (viewedPreview) recentlyViewedActiveChatPreviewsRef.current.set(chatKey, viewedPreview)
      }
      markChatSeenAt(
        selectedChat.providerId,
        selectedChat.id,
        Math.max(
          Date.now(),
          selectedChat.updatedAt,
          selectedChatUpdatedAtRef.current ?? 0,
          cacheEntry?.updatedAt ?? 0
        )
      )
    },
    [markChatSeenAt, selectedChat]
  )

  const applyViewedChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      options: ApplyChatDetailOptions = {}
    ): void => {
      applyChatDetail(providerId, detail, options)
      markChatSeenAt(providerId, detail.id, Date.now())
    },
    [applyChatDetail, markChatSeenAt]
  )

  useEffect(
    () =>
      providerApi.onChatUpdated((event) => {
        const updatedChatKey = getChatKey({ providerId: event.providerId, id: event.chatId })
        const viewingUpdatedChat = selectedChatKeyRef.current === updatedChatKey
        const recentlyViewedPreview =
          recentlyViewedActiveChatPreviewsRef.current.get(updatedChatKey)
        const completedWhileRecentlyViewed =
          !viewingUpdatedChat &&
          isViewedChatCompletion(
            recentlyViewedPreview,
            event.summary.preview,
            event.summary.previewLength,
            event.turnCompleted
          )
        if (
          recentlyViewedPreview &&
          (event.summary.preview !== recentlyViewedPreview.preview ||
            event.summary.previewLength !== recentlyViewedPreview.length ||
            event.turnCompleted)
        ) {
          recentlyViewedActiveChatPreviewsRef.current.delete(updatedChatKey)
        }
        const mergedSelectedDetail =
          viewingUpdatedChat && event.detail
            ? getChatDetailFromUpdate(
                event.detail,
                chatDetailRef.current,
                shouldPreserveOptimisticTurnUntilUserMessage(event.providerId)
              )
            : null
        const selectedDetail = (() => {
          if (!mergedSelectedDetail) return null
          const currentWindow = chatTurnWindowRef.current
          if (!currentWindow || currentWindow.chatKey !== updatedChatKey) {
            return mergedSelectedDetail
          }

          const totalCount = getChatDetailTurnCount(mergedSelectedDetail)
          const retainedWindow = getEffectiveChatTurnWindow(
            currentWindow,
            getLatestChatTurnWindow(updatedChatKey, totalCount, chatTurnWindowSize),
            chatAutoScrollEnabledRef.current
          )
          return retainLoadedChatDetailTurnWindow(mergedSelectedDetail, retainedWindow)
        })()

        if (selectedDetail) {
          chatDetailResyncRequestIdRef.current += 1
          chatDetailResyncRef.current = null
          applyChatDetail(event.providerId, selectedDetail)
          setCommittedChatUpdate({
            sequence: event.sequence,
            detailApplied: true,
            turnCompleted: event.turnCompleted
          })
        } else {
          applyChatSummary(event.providerId, event.summary, event.turnCompleted)
          if (viewingUpdatedChat) {
            const retainedDetail = chatDetailRef.current
            if (retainedDetail?.id === event.chatId) {
              // Keep the selected chat interactive while recovering a missed or unmergeable
              // detail update. Clearing it would disable and blur the focused message composer.
              const currentResync = chatDetailResyncRef.current
              if (!currentResync || currentResync.chatKey !== updatedChatKey) {
                const requestId = chatDetailResyncRequestIdRef.current + 1
                chatDetailResyncRequestIdRef.current = requestId
                chatDetailResyncRef.current = { chatKey: updatedChatKey, requestId }

                void providerApi
                  .getChat(event.providerId, event.chatId)
                  .then((detail) => {
                    const pendingResync = chatDetailResyncRef.current
                    if (
                      pendingResync?.requestId !== requestId ||
                      pendingResync.chatKey !== updatedChatKey
                    ) {
                      return
                    }

                    chatDetailResyncRef.current = null
                    if (selectedChatKeyRef.current !== updatedChatKey) return
                    applyChatDetail(event.providerId, detail)
                  })
                  .catch(() => {
                    if (chatDetailResyncRef.current?.requestId === requestId) {
                      chatDetailResyncRef.current = null
                    }
                  })
              }
            } else {
              chatDetailRef.current = null
              setChatDetail(null)
              setChatLoadState('loading')
              setChatLoadRequest((currentRequest) => currentRequest + 1)
            }
          }
          providerApi.acknowledgeChatUpdate(event.sequence, false)
        }
        if ((viewingUpdatedChat && event.turnCompleted) || completedWhileRecentlyViewed) {
          markChatSeenAt(
            event.providerId,
            event.chatId,
            Math.max(
              Date.now(),
              event.summary.updatedAt,
              viewingUpdatedChat ? (selectedChatUpdatedAtRef.current ?? 0) : 0
            )
          )
        }
        if (
          event.turnCompleted &&
          changesCwdRef.current &&
          event.summary.cwd === changesCwdRef.current
        ) {
          setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
          setGitBranchLoadRequest((currentRequest) => currentRequest + 1)
          setFileTreeLoadRequest((currentRequest) => currentRequest + 1)
        }
        const commitActivity = scopedCommitActivitiesRef.current[updatedChatKey]
        if (commitActivity && !isActiveChatStatus(event.summary.status)) {
          const finishCommitActivity = (detail: ProviderChatDetail): void => {
            setChatCommitMarkers((currentMarkers) => {
              const marker = currentMarkers[commitActivity.markerId]
              if (!marker || marker.status !== 'pending') return currentMarkers

              return {
                ...currentMarkers,
                [marker.id]: {
                  ...marker,
                  status: getChatCommitMarkerTerminalStatus(detail),
                  afterItemId:
                    commitActivity.chatId === commitActivity.sourceChatId
                      ? getLastChatCommitMarkerAnchorId(detail.items, marker.afterItemId)
                      : marker.afterItemId,
                  finishedAt: Date.now()
                }
              }
            })
            setScopedCommitActivities((currentActivities) => {
              if (!currentActivities[updatedChatKey]) return currentActivities

              const nextActivities = { ...currentActivities }
              delete nextActivities[updatedChatKey]
              return nextActivities
            })
          }

          if (selectedDetail) {
            finishCommitActivity(selectedDetail)
          } else {
            void providerApi
              .getChat(event.providerId, event.chatId)
              .then(finishCommitActivity)
              .catch(() => {
                // Keep the activity pending so startup recovery can finish it later.
              })
          }
        }
        if (commitActivity && isActiveChatStatus(event.summary.status)) {
          setScopedCommitActivities((currentActivities) => {
            const currentActivity = currentActivities[updatedChatKey]
            if (!currentActivity) return currentActivities

            return {
              ...currentActivities,
              [updatedChatKey]: {
                ...currentActivity,
                currentAction: selectedDetail
                  ? getCommitActivityCurrentAction(selectedDetail, currentActivity.commitAction)
                  : getCommitActivityCurrentActionFromSummary(
                      event.summary,
                      currentActivity.commitAction
                    )
              }
            }
          })
        }
      }),
    [applyChatDetail, applyChatSummary, markChatSeenAt]
  )

  useEffect(() => {
    if (!committedChatUpdate) return
    if (committedChatUpdate.turnCompleted) {
      providerApi.acknowledgeChatUpdate(
        committedChatUpdate.sequence,
        committedChatUpdate.detailApplied
      )
      return
    }

    const timeout = window.setTimeout(() => {
      providerApi.acknowledgeChatUpdate(
        committedChatUpdate.sequence,
        committedChatUpdate.detailApplied
      )
    }, streamingChatUpdateIntervalMs)
    return () => window.clearTimeout(timeout)
  }, [committedChatUpdate])

  const {
    activeSubagentChatView,
    approvalDecisionInFlight,
    approvalError,
    browserWorkspaceKey,
    changesContainer,
    changesContainerKey,
    changesCwd,
    changesProjectCwd,
    closeChatSearch,
    committingChatKeys,
    latestCommitFinishedAtByChatKey,
    gitAvailabilityScopeKey,
    gitAvailableForCurrentSource,
    handleChangesPaneViewChange,
    handleRunAction,
    messageBoxPlan,
    pendingApproval,
    pendingUserInput,
    recentlyOpenedFilesWorkspaceKey,
    refreshAccountUsage,
    resetAccountRateLimits,
    resolvingApprovalId,
    scopedCommitActivitiesByMarkerId,
    selectedChatCommitMarkers,
    selectedChatId,
    selectedChatKey,
    selectedChatSubagents,
    selectedProviderId,
    terminalWorkspaceKey,
    userInputError,
    userInputResolving
  } = useWorkspaceSelection({
    selectedChat,
    subagentChatView,
    subagentListState,
    chatDetail,
    setSubagentListState,
    setSubagentChatView,
    selectedChatKeyRef,
    subagentChatLoadRequestRef,
    chatDetailResyncRequestIdRef,
    chatDetailResyncRef,
    scopedCommitActivities,
    startingScopedCommitActivities,
    chatCommitMarkers,
    extractedChatPlan,
    effectiveAppSettings,
    setExtractedChatPlan,
    newSessionProvider,
    newSessionProviderAvailable,
    newSessionSourceAvailabilityReady,
    newSessionCwd,
    newSessionContainer,
    gitSourceAvailability,
    lastGitAvailable,
    changesContainerRef,
    changeSourceRef,
    changeSource,
    setGitSourceAvailability,
    setLastGitAvailable,
    setGitAvailabilityChangeId,
    gitAvailableRef,
    gitBranchLoadRequest,
    gitChangeLoadRequest,
    setTerminalOpened,
    setBrowserOpened,
    lastNonTerminalChangesPaneViewRef,
    setChangesPaneView,
    changesPaneView,
    setAppSettings,
    runPromptActionRef,
    setTerminalCommandLaunchRequest,
    updateAppearanceZoomLevel,
    settingsOpen,
    fileEditorTarget,
    appSettings,
    changesCwdRef,
    approvalResolution,
    userInputResolution,
    setAccountUsage,
    setAccountUsageState,
    setAccountUsageError,
    loadState,
    providerAccountRevision,
    chatDetailRef,
    cacheRecentChatDetail,
    selectedChatUpdatedAtRef,
    setChatDetail,
    setChatLoadState,
    markChatSeenAt,
    chatLoadRequest,
    chatInitialLayoutKeyRef,
    contentRef,
    chatAutoScrollEnabledRef,
    chatUserScrollIntentRef,
    chatAutoScrollTargetRef,
    scrollChatContentToBottom,
    scheduleChatAutoScroll,
    loadedWorkingStepIdsRef,
    chatScrollAdjustmentTargetRef,
    pendingChatScrollAnchorRef,
    chatViewportAnchorRef,
    previousChatScrollTopRef,
    searchOpen,
    searchInputRef,
    chatSearchReturnFocusRef,
    resetChatSearch,
    chatTurnWindowRef,
    chatSearchOpen,
    setChatSearchOpen,
    chatSearchInputRef,
    chatSearchContentRef,
    chatSearchQuery,
    chatSearchActiveIndexRef,
    chatSearchMatchesRef,
    setChatSearchMatchCount,
    setChatSearchActiveIndex,
    setGitBranchActionState,
    setGitBranchError,
    setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry,
    setGitChangeLoadError,
    setUncommittedPatchFilterError,
    setGitChangeLoadErrorDismissed,
    newChatOpen,
    setDefaultCwd,
    setNewSessionCwd,
    gitBranchRequestIdRef,
    setGitBranches,
    setGitBranchesScope,
    setGitBranchLoadState,
    gitAvailabilityChangeId,
    setGitChangeLoadScope,
    setGitChangeLoadState,
    setGitChanges,
    setGitChangesScope,
    setUncommittedPatchFilterState,
    setUncommittedPatchFilter,
    setFileTreeLoadScope,
    setFileTreeLoadState,
    setFileTree,
    setFileTreeScope,
    setLastOpenedFileTreeFolderPath,
    lastOpenedFileTreeFolderByCwdRef,
    collapsedFileTreeFoldersByCwdRef,
    setCollapsedFileTreeFolders,
    fileTreeLoadRequest
  })

  const searchTerms = searchQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const filteredChats =
    searchTerms.length === 0
      ? chats
      : chats.filter((chat) => {
          const title = chat.title.toLocaleLowerCase()
          const cwd = chat.cwd?.toLocaleLowerCase() ?? ''
          const cwdLabel = getChatCwdLabel(chat.cwd).toLocaleLowerCase()
          return searchTerms.every(
            (term) => title.includes(term) || cwd.includes(term) || cwdLabel.includes(term)
          )
        })
  const projectRecordsByCwd = new Map(projects.map((project) => [project.cwd, project]))
  const projectNamesByCwd = new Map(
    projects.map((project) => [project.cwd, getProjectDisplayName(project)])
  )
  const chatGroups = groupChatsForSidebar(filteredChats, projectRecordsByCwd).map((group) => {
    if (group.kind !== 'cwd' || !group.cwd) return group

    const project = projectRecordsByCwd.get(group.cwd)
    return project ? { ...group, projectName: getProjectDisplayName(project) } : group
  })
  const pinnedChatGroup = chatGroups.find((group) => group.kind === 'pinned') ?? null
  const activeChatGroups = chatGroups.filter((group) => group.kind === 'cwd')
  const displayedActiveChatGroups =
    chatGroupingPreference === 'grouped' || activeChatGroups.length === 0
      ? activeChatGroups
      : [
          {
            key: activeGroupKey,
            cwd: null,
            label: 'Active',
            chats: sortChatsForGroup(activeChatGroups.flatMap((group) => group.chats)),
            kind: 'active' as const
          }
        ]
  const doneChatGroup = chatGroups.find((group) => group.kind === 'done') ?? null
  const messageBoxNotesCwd = selectedChat ? changesProjectCwd : newSessionCwd
  const messageBoxNotesVisible = Boolean(selectedChat) || newChatOpen
  const messageBoxNotesGroup = useMemo(
    () =>
      messageBoxNotesVisible
        ? {
            key: getChatCwdGroupKey(messageBoxNotesCwd),
            cwd: messageBoxNotesCwd,
            label: getChatCwdLabel(messageBoxNotesCwd)
          }
        : null,
    [messageBoxNotesCwd, messageBoxNotesVisible]
  )

  useEffect(() => {
    const notesGroups = new Map(
      activeChatGroups.map((group) => [group.key, { key: group.key, cwd: group.cwd }])
    )
    if (messageBoxNotesGroup) {
      notesGroups.set(messageBoxNotesGroup.key, {
        key: messageBoxNotesGroup.key,
        cwd: messageBoxNotesGroup.cwd
      })
    }
    const groupsToLoad = Array.from(notesGroups.values()).filter(
      (group) => !(group.key in cwdNotesByGroup) && !loadingCwdNotesRef.current.has(group.key)
    )
    if (groupsToLoad.length === 0) return

    groupsToLoad.forEach((group) => loadingCwdNotesRef.current.add(group.key))

    void Promise.all(
      groupsToLoad.map((group) =>
        providerApi
          .getCwdNotes('codex', group.cwd)
          .then((notes) => ({ key: group.key, notes }))
          .catch(() => ({ key: group.key, notes: [] }))
      )
    ).then((groupNotes) => {
      groupNotes.forEach(({ key }) => loadingCwdNotesRef.current.delete(key))

      setCwdNotesByGroup((currentNotes) => {
        const nextNotes = { ...currentNotes }
        groupNotes.forEach(({ key, notes }) => {
          nextNotes[key] = notes
        })
        return nextNotes
      })
    })
  }, [activeChatGroups, cwdNotesByGroup, messageBoxNotesGroup])

  useEffect(() => {
    const entriesByKey = new Map<string, { key: string; cwd: string | null }>()
    const addProjectIconEntry = (cwd: string | null): void => {
      const key = getChatCwdGroupKey(cwd)
      if (!entriesByKey.has(key)) entriesByKey.set(key, { key, cwd })
    }

    activeChatGroups.forEach((group) => addProjectIconEntry(group.cwd))
    projects.forEach((project) => addProjectIconEntry(project.cwd))
    addProjectIconEntry(newSessionCwd)

    const projectIconEntries = Array.from(entriesByKey.values())
    const iconsToLoad = projectIconEntries.filter(
      (entry) =>
        !(entry.key in projectIconsByGroup) && !loadingProjectIconsRef.current.has(entry.key)
    )
    if (iconsToLoad.length === 0) return

    iconsToLoad.forEach((entry) => loadingProjectIconsRef.current.add(entry.key))

    void Promise.all(
      iconsToLoad.map((entry) =>
        appApi
          .getProjectIcon({ cwd: entry.cwd })
          .then((icon) => ({ key: entry.key, icon }))
          .catch(() => ({ key: entry.key, icon: null }))
      )
    ).then((groupIcons) => {
      groupIcons.forEach(({ key }) => loadingProjectIconsRef.current.delete(key))

      setProjectIconsByGroup((currentIcons) => {
        const nextIcons = { ...currentIcons }
        groupIcons.forEach(({ key, icon }) => {
          nextIcons[key] = icon
        })
        return nextIcons
      })
    })
  }, [activeChatGroups, newSessionCwd, projects, projectIconsByGroup])

  const projectOptions = useMemo<DropdownOption<string>[]>(() => {
    const projectsByCwd = new Map<
      string,
      { cwd: string; updatedAt: number; project: AppProject | null }
    >()

    const addProject = (
      cwd: string | null,
      updatedAt: number,
      project: AppProject | null = null
    ): void => {
      const normalizedCwd = cwd?.trim()
      if (!normalizedCwd) return

      const existingProject = projectsByCwd.get(normalizedCwd)
      if (!existingProject || updatedAt > existingProject.updatedAt) {
        projectsByCwd.set(normalizedCwd, {
          cwd: normalizedCwd,
          updatedAt,
          project: project ?? existingProject?.project ?? null
        })
      }
    }

    projects.forEach((project) => addProject(project.cwd, project.updatedAt, project))
    addProject(newSessionCwd, Number.MAX_SAFE_INTEGER)

    const getProjectOptionIcon = (
      cwd: string | null,
      project: AppProject | null = null
    ): React.ReactElement => {
      const projectImage = projectIconsByGroup[getChatCwdGroupKey(cwd)]
      const usesProjectImage = project?.icon === 'image' || project?.icon == null

      if (usesProjectImage && projectImage?.dataUrl) {
        return <img src={projectImage.dataUrl} alt="" />
      }
      if (project?.icon && project.icon !== 'image') return renderProjectGlyph(project.icon)
      return <FolderKanban aria-hidden="true" />
    }

    const options = Array.from(projectsByCwd.values())
      .sort((firstProject, secondProject) => {
        if (secondProject.updatedAt !== firstProject.updatedAt) {
          return secondProject.updatedAt - firstProject.updatedAt
        }

        return getFolderName(firstProject.cwd).localeCompare(getFolderName(secondProject.cwd))
      })
      .map((project) => ({
        value: project.cwd,
        label: project.project
          ? getProjectDisplayName(project.project)
          : getFolderName(project.cwd),
        menuLabel: project.project
          ? getProjectDisplayName(project.project)
          : getFolderName(project.cwd),
        description: getFolderDescription(project.cwd),
        icon: getProjectOptionIcon(project.cwd, project.project)
      }))

    if (!newSessionCwd) {
      return [
        {
          value: newSessionProjectPlaceholderValue,
          label: 'Choose folder',
          icon: getProjectOptionIcon(null),
          disabled: true
        },
        ...options
      ]
    }

    return options
  }, [newSessionCwd, projects, projectIconsByGroup])
  const newSessionProjectValue = newSessionCwd ?? newSessionProjectPlaceholderValue
  const handleDeleteSshEnvironment = useCallback(
    async (environment: AppSshEnvironment): Promise<void> => {
      if (deletingSshEnvironmentId) return

      setDeletingSshEnvironmentId(environment.id)
      setSshEnvironmentError(null)
      try {
        await appApi.deleteSshEnvironment({ id: environment.id })
        setSshEnvironments((currentEnvironments) =>
          currentEnvironments.filter(
            (currentEnvironment) => currentEnvironment.id !== environment.id
          )
        )
        setNewSessionContainer((currentContainer) =>
          currentContainer.kind === 'container' &&
          currentContainer.tool === 'ssh' &&
          currentContainer.name === environment.id
            ? { kind: 'host' }
            : currentContainer
        )
      } catch (error) {
        setSshEnvironmentError(getErrorMessage(error, 'Unable to remove environment.'))
      } finally {
        setDeletingSshEnvironmentId(null)
      }
    },
    [deletingSshEnvironmentId]
  )
  const containerOptions = useMemo<DropdownOption<string>[]>(
    () => [
      {
        value: hostContainerValue,
        label: 'Host',
        icon: <Monitor aria-hidden="true" />
      },
      ...sshEnvironments.map((environment) => ({
        value: `ssh:${environment.id}`,
        label: environment.name,
        menuLabel: environment.name,
        description: `${environment.user ? `${environment.user}@` : ''}${environment.host}:${environment.port}`,
        icon: <Server aria-hidden="true" />,
        inlineActions: [
          {
            id: `edit-${environment.id}`,
            ariaLabel: `Edit ${environment.name}`,
            title: `Edit ${environment.name}`,
            icon: <Pencil aria-hidden="true" />,
            callback: () => {
              setEditingSshEnvironment(environment)
              setSshEnvironmentError(null)
              setSshEnvironmentDialogOpen(true)
            }
          },
          {
            id: `remove-${environment.id}`,
            ariaLabel: `Remove ${environment.name}`,
            title: `Remove ${environment.name}`,
            disabled: Boolean(deletingSshEnvironmentId),
            icon: <X aria-hidden="true" />,
            callback: () => handleDeleteSshEnvironment(environment)
          }
        ]
      })),
      ...containerSuggestions.map((container) => ({
        value: container.id,
        label: container.name,
        menuLabel: `${container.name} · ${getContainerSuggestionState(container)}`,
        icon: getContainerToolIcon(container.tool)
      }))
    ],
    [containerSuggestions, deletingSshEnvironmentId, handleDeleteSshEnvironment, sshEnvironments]
  )
  const newSessionRemoteRuntime = useMemo<AppLocalContainerTarget | null>(
    () =>
      newSessionContainer.kind === 'container' && newSessionContainer.tool === 'ssh'
        ? (newSessionContainer.runtime ?? { kind: 'host' })
        : null,
    [newSessionContainer]
  )
  const remoteRuntimeOptions = useMemo<DropdownOption<string>[]>(() => {
    const suggestions = [...remoteContainerSuggestions]
    if (
      newSessionRemoteRuntime?.kind === 'container' &&
      !suggestions.some(
        (suggestion) =>
          suggestion.tool === newSessionRemoteRuntime.tool &&
          suggestion.name === newSessionRemoteRuntime.name
      )
    ) {
      suggestions.unshift({
        id: `${newSessionRemoteRuntime.tool}:${newSessionRemoteRuntime.name}`,
        tool: newSessionRemoteRuntime.tool,
        name: newSessionRemoteRuntime.name,
        label: newSessionRemoteRuntime.name,
        description: null,
        status: null
      })
    }

    return [
      {
        value: hostContainerValue,
        label: 'Host',
        icon: <Monitor aria-hidden="true" />
      },
      ...suggestions.map((container) => ({
        value: container.id,
        label: container.name,
        menuLabel: `${container.name} · ${getContainerSuggestionState(container)}`,
        icon: getContainerToolIcon(container.tool)
      }))
    ]
  }, [newSessionRemoteRuntime, remoteContainerSuggestions])
  const newSessionProviderOptions = useMemo<DropdownOption<ProviderId>[]>(
    () =>
      providerOptions.filter((option) =>
        newSessionAvailableProviderIds.includes(option.value as ProviderId)
      ),
    [newSessionAvailableProviderIds]
  )
  const newSessionProviderValueContent = !newSessionSourceAvailabilityReady
    ? 'Checking'
    : newSessionProviderOptions.length === 0
      ? 'No providers found'
      : undefined
  const newSessionContainerValue = getContainerSelectionValue(newSessionContainer)
  const handleNewSessionContainerChange = (value: string): void => {
    if (value === hostContainerValue) {
      setNewSessionContainer({ kind: 'host' })
      return
    }

    const environment = sshEnvironments.find(
      (candidateEnvironment) => `ssh:${candidateEnvironment.id}` === value
    )
    if (environment) {
      setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: environment.id,
        runtime: { kind: 'host' }
      })
      return
    }

    const suggestion = containerSuggestions.find((container) => container.id === value)
    if (suggestion) setNewSessionContainer(getContainerTargetFromSuggestion(suggestion))
  }
  const handleNewSessionRemoteRuntimeChange = (value: string): void => {
    if (!newSessionSshEnvironmentId) return
    if (value === hostContainerValue) {
      setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: newSessionSshEnvironmentId,
        runtime: { kind: 'host' }
      })
      return
    }

    const suggestion = remoteContainerSuggestions.find((container) => container.id === value)
    if (!suggestion) return
    setNewSessionContainer({
      kind: 'container',
      tool: 'ssh',
      name: newSessionSshEnvironmentId,
      runtime: getContainerTargetFromSuggestion(suggestion)
    })
  }
  const applyProviderAccountConfiguration = (configuration: ProviderAccountConfiguration): void => {
    setSettingsProviderAccounts(configuration)
    setProviderAccountsError(null)
    setProviderAccountsLoadState('ready')
    providerModelCatalogCacheRef.current.delete(
      `${newSessionProvider}:${getContainerTargetKey(newSessionContainer)}`
    )
    setProviderModelsRevision((revision) => revision + 1)
    setProviderResourcesRefresh((refresh) => refresh + 1)
    setAccountUsage(null)
    setAccountUsageState('loading')
  }
  const handleUseProviderAccount = async (accountId: string): Promise<void> => {
    if (providerAccountUpdatingId) return
    const container = normalizeContainerTarget(newSessionContainer)
    setProviderAccountUpdatingId(accountId)
    setProviderAccountsError(null)
    try {
      applyProviderAccountConfiguration(
        await providerApi.useAccount(newSessionProvider, accountId, { container })
      )
      setProviderAccountRevision((revision) => revision + 1)
    } catch (error) {
      setProviderAccountsError(getErrorMessage(error, 'Unable to switch accounts.'))
    } finally {
      setProviderAccountUpdatingId(null)
    }
  }
  const handleDeleteProviderAccount = async (accountId: string): Promise<void> => {
    if (providerAccountUpdatingId) return
    const account = settingsProviderAccounts?.accounts.find(
      (candidate) => candidate.id === accountId
    )
    if (!account || !window.confirm(`Delete the account “${account.name}”?`)) return

    const container = normalizeContainerTarget(newSessionContainer)
    setProviderAccountUpdatingId(accountId)
    setProviderAccountsError(null)
    try {
      applyProviderAccountConfiguration(
        await providerApi.deleteAccount(newSessionProvider, accountId, { container })
      )
      setProviderAccountRevision((revision) => revision + 1)
    } catch (error) {
      setProviderAccountsError(getErrorMessage(error, 'Unable to delete the account.'))
    } finally {
      setProviderAccountUpdatingId(null)
    }
  }
  const handleCreateProviderAccount = async (
    name: string
  ): Promise<AccountAuthorizationSession> => {
    const providerId = newSessionProvider
    const container = normalizeContainerTarget(newSessionContainer)
    const creation = await providerApi.createAccount(providerId, name, { container })
    let loginId: string | null = null
    let userCode: string | null = null
    let authUrl: string | null = null
    try {
      const login = await providerApi.login(providerId, { container })
      if (login.status === 'pending') {
        loginId = login.loginId
        userCode = login.userCode ?? null
        authUrl = login.authUrl
      }
    } catch (error) {
      try {
        const restoredConfiguration = await providerApi.cancelAccountCreation(
          providerId,
          creation.accountId,
          loginId,
          { container }
        )
        applyProviderAccountConfiguration(restoredConfiguration)
        setProviderAccountRevision((revision) => revision + 1)
      } catch {
        // Keep the original login error when cleanup cannot be completed.
      }
      throw error
    }

    const completion = (async (): Promise<void> => {
      try {
        const result = await providerApi.completeAccountCreation(
          providerId,
          creation.accountId,
          loginId,
          { container }
        )
        applyProviderAccountConfiguration(result.configuration)
        setProviderAccountRevision((revision) => revision + 1)
        if (!result.success) {
          throw new Error(result.error || 'Codex authorization was not completed.')
        }
      } catch (error) {
        const restoredConfiguration = await providerApi
          .getAccounts(providerId, { container })
          .catch(() => null)
        if (restoredConfiguration) applyProviderAccountConfiguration(restoredConfiguration)
        throw error
      }
    })()

    return {
      userCode,
      completion,
      authorize: async () => {
        if (!authUrl) return
        if (userCode) await appApi.writeClipboardText(userCode)
        await appApi.handleExternalLink({ url: authUrl, action: 'open' })
      },
      cancel: async () => {
        const configuration = await providerApi.cancelAccountCreation(
          providerId,
          creation.accountId,
          loginId,
          { container }
        )
        applyProviderAccountConfiguration(configuration)
        setProviderAccountRevision((revision) => revision + 1)
      }
    }
  }
  const handleProviderSkillEnabledChange = async (
    resource: SettingsProviderSkill,
    enabled: boolean
  ): Promise<void> => {
    const updateKey = `skill:${resource.skill.path}`
    if (providerResourceUpdatingKey || resource.skill.enabled === enabled) return
    const container = normalizeContainerTarget(newSessionContainer)

    setProviderResourceUpdatingKey(updateKey)
    setProviderResourcesError(null)
    setSettingsProviderSkills((currentResources) =>
      currentResources.map((currentResource) =>
        currentResource.skill.path === resource.skill.path
          ? { ...currentResource, skill: { ...currentResource.skill, enabled } }
          : currentResource
      )
    )
    try {
      await providerApi.setSkillEnabled(
        resource.providerId,
        resource.skill.path,
        enabled,
        settingsProjectCwd,
        {
          container,
          deferRefresh: true,
          knownSkills: [resource.skill]
        }
      )
    } catch (error) {
      setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) =>
          currentResource.skill.path === resource.skill.path
            ? {
                ...currentResource,
                skill: { ...currentResource.skill, enabled: resource.skill.enabled }
              }
            : currentResource
        )
      )
      setProviderResourcesError(getErrorMessage(error, 'Unable to update skill.'))
    } finally {
      queueDeferredProviderResourceRefresh({
        providerId: resource.providerId,
        cwd: settingsProjectCwd,
        container
      })
      setProviderResourceUpdatingKey(null)
    }
  }
  const handleProviderAppEnabledChange = async (
    resource: SettingsProviderApp,
    childSkills: SettingsProviderSkill[],
    enabled: boolean
  ): Promise<void> => {
    const updateKey = `app:${resource.providerId}:${resource.app.id}`
    const childSkillPaths = new Set(childSkills.map((childSkill) => childSkill.skill.path))
    const container = normalizeContainerTarget(newSessionContainer)
    if (
      providerResourceUpdatingKey ||
      (resource.app.enabled === enabled &&
        childSkills.every((childSkill) => childSkill.skill.enabled === enabled))
    ) {
      return
    }

    setProviderResourceUpdatingKey(updateKey)
    setProviderResourcesError(null)
    setSettingsProviderApps((currentResources) =>
      currentResources.map((currentResource) =>
        currentResource.providerId === resource.providerId &&
        currentResource.app.id === resource.app.id
          ? { ...currentResource, app: { ...currentResource.app, enabled } }
          : currentResource
      )
    )
    setSettingsProviderSkills((currentResources) =>
      currentResources.map((currentResource) =>
        childSkillPaths.has(currentResource.skill.path)
          ? { ...currentResource, skill: { ...currentResource.skill, enabled } }
          : currentResource
      )
    )
    try {
      await providerApi.setAppEnabled(resource.providerId, resource.app.id, enabled, {
        container,
        deferRefresh: true,
        knownApp: resource.app,
        knownSkills: childSkills.map((childSkill) => childSkill.skill)
      })
    } catch (error) {
      const previousChildState = new Map(
        childSkills.map((childSkill) => [childSkill.skill.path, childSkill.skill.enabled])
      )
      setSettingsProviderApps((currentResources) =>
        currentResources.map((currentResource) =>
          currentResource.providerId === resource.providerId &&
          currentResource.app.id === resource.app.id
            ? {
                ...currentResource,
                app: { ...currentResource.app, enabled: resource.app.enabled }
              }
            : currentResource
        )
      )
      setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) => {
          const previousEnabled = previousChildState.get(currentResource.skill.path)
          return previousEnabled == null
            ? currentResource
            : {
                ...currentResource,
                skill: { ...currentResource.skill, enabled: previousEnabled }
              }
        })
      )
      setProviderResourcesError(getErrorMessage(error, 'Unable to update app.'))
    } finally {
      queueDeferredProviderResourceRefresh({
        providerId: resource.providerId,
        cwd: settingsProjectCwd,
        container
      })
      setProviderResourceUpdatingKey(null)
    }
  }
  const handleProviderSkillsEnabledChange = async (
    resources: SettingsProviderSkill[],
    enabled: boolean
  ): Promise<void> => {
    const changedResources = resources.filter((resource) => resource.skill.enabled !== enabled)
    if (providerResourceUpdatingKey || changedResources.length === 0) return

    const updateKey = 'skills:unparented'
    const changedSkillPaths = new Set(changedResources.map((resource) => resource.skill.path))
    const previousSkillState = new Map(
      changedResources.map((resource) => [resource.skill.path, resource.skill.enabled])
    )
    const container = normalizeContainerTarget(newSessionContainer)
    const pathsByProvider = new Map<ProviderId, string[]>()
    changedResources.forEach((resource) => {
      pathsByProvider.set(resource.providerId, [
        ...(pathsByProvider.get(resource.providerId) ?? []),
        resource.skill.path
      ])
    })

    setProviderResourceUpdatingKey(updateKey)
    setProviderResourcesError(null)
    setSettingsProviderSkills((currentResources) =>
      currentResources.map((currentResource) =>
        changedSkillPaths.has(currentResource.skill.path)
          ? { ...currentResource, skill: { ...currentResource.skill, enabled } }
          : currentResource
      )
    )
    try {
      const updatedSkillLists = await Promise.all(
        Array.from(pathsByProvider, ([providerId, paths]) =>
          providerApi.setSkillsEnabled(providerId, paths, enabled, settingsProjectCwd, {
            container,
            deferRefresh: true,
            knownSkills: changedResources
              .filter((resource) => resource.providerId === providerId)
              .map((resource) => resource.skill)
          })
        )
      )
      const updateResolution = resolveSettingsProviderSkillUpdates(
        changedResources,
        updatedSkillLists.flat(),
        enabled
      )
      setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) => {
          const updatedSkill = updateResolution.skillsByPath.get(currentResource.skill.path)
          return updatedSkill ? { ...currentResource, skill: updatedSkill } : currentResource
        })
      )
      if (updateResolution.failedCount > 0) {
        setProviderResourcesError(
          `${updateResolution.failedCount} ${updateResolution.failedCount === 1 ? 'skill' : 'skills'} could not be updated.`
        )
      }
    } catch (error) {
      setSettingsProviderSkills((currentResources) =>
        currentResources.map((currentResource) => {
          const previousEnabled = previousSkillState.get(currentResource.skill.path)
          return previousEnabled == null
            ? currentResource
            : {
                ...currentResource,
                skill: { ...currentResource.skill, enabled: previousEnabled }
              }
        })
      )
      setProviderResourcesError(getErrorMessage(error, 'Unable to update skills.'))
    } finally {
      pathsByProvider.forEach((_, providerId) =>
        queueDeferredProviderResourceRefresh({
          providerId,
          cwd: settingsProjectCwd,
          container
        })
      )
      setProviderResourceUpdatingKey(null)
    }
  }
  const handleSaveSshEnvironment = async (
    options: AppCreateSshEnvironmentOptions
  ): Promise<void> => {
    const environment = editingSshEnvironment
      ? await appApi.updateSshEnvironment({ id: editingSshEnvironment.id, ...options })
      : await appApi.createSshEnvironment(options)
    setSshEnvironments((currentEnvironments) => [
      environment,
      ...currentEnvironments.filter(
        (currentEnvironment) => currentEnvironment.id !== environment.id
      )
    ])
    setSshEnvironmentError(null)
    if (!editingSshEnvironment) {
      setNewSessionContainer({
        kind: 'container',
        tool: 'ssh',
        name: environment.id,
        runtime: { kind: 'host' }
      })
    }
  }
  const gitSettingsModelsCurrent = gitSettingsUsesConfigProviderModels
    ? displayedModelCatalogKey === gitSettingsModelCatalogKey
    : displayedGitSettingsModelCatalogKey === gitSettingsModelCatalogKey
  const gitSettingsModelCatalog = gitSettingsUsesConfigProviderModels ? models : gitSettingsModels
  const gitSettingsModelCatalogLoading = gitSettingsUsesConfigProviderModels
    ? modelsLoading
    : gitSettingsModelsLoading
  const displayedGitSettingsModels = useMemo(
    () => (gitSettingsModelsCurrent ? gitSettingsModelCatalog : []),
    [gitSettingsModelCatalog, gitSettingsModelsCurrent]
  )
  const savedGitCommitModel = getAppGitCommitModel(
    settingsPanelSettings.git.commitModels,
    newSessionProvider,
    newSessionContainerKey
  )
  const savedGitCommitModelOption = savedGitCommitModel
    ? displayedGitSettingsModels.find((candidateModel) => candidateModel.id === savedGitCommitModel)
    : undefined
  const modelLabelsById = useMemo(
    () =>
      new Map<ProviderModelId, string>(
        models.map((candidateModel) => [candidateModel.id, formatModelLabel(candidateModel.label)])
      ),
    [models]
  )
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
  const effectiveSandboxMode =
    effectiveAppSettings.chat.forceAccess === appChatManualDropdownValue
      ? sandboxMode
      : effectiveAppSettings.chat.forceAccess
  const effectiveAgentMode = agentModes.some((mode) => mode.id === agentMode)
    ? agentMode
    : 'interactive'
  const configuredApprovalMode =
    effectiveAppSettings.chat.forceReview === appChatManualDropdownValue
      ? approvalMode
      : effectiveAppSettings.chat.forceReview
  const effectiveApprovalMode =
    effectiveSandboxMode === 'danger-full-access' ? 'never' : configuredApprovalMode
  const configuredModel =
    effectiveAppSettings.chat.forceModel === appChatManualDropdownValue
      ? model
      : effectiveAppSettings.chat.forceModel
  const effectiveModel = models.some((candidateModel) => candidateModel.id === configuredModel)
    ? configuredModel
    : getDefaultModel(models).id
  const selectedEffectiveModel = models.find(
    (candidateModel) => candidateModel.id === effectiveModel
  )
  const configuredServiceTier =
    effectiveAppSettings.chat.forceSpeed === appChatManualDropdownValue
      ? serviceTier
      : effectiveAppSettings.chat.forceSpeed === appChatStandardSpeedValue
        ? null
        : effectiveAppSettings.chat.forceSpeed
  const effectiveServiceTier = modelSupportsServiceTier(
    selectedEffectiveModel,
    configuredServiceTier
  )
    ? configuredServiceTier
    : (selectedEffectiveModel?.defaultServiceTier ?? null)
  const configuredReasoningEffort =
    effectiveAppSettings.chat.forceReasoning === appChatManualDropdownValue
      ? reasoningEffort
      : effectiveAppSettings.chat.forceReasoning
  const effectiveReasoningEffort = modelSupportsReasoningEffort(
    selectedEffectiveModel,
    configuredReasoningEffort
  )
    ? configuredReasoningEffort
    : getDefaultReasoningEffort(selectedEffectiveModel)
  const hasForcedChatDropdown =
    effectiveAppSettings.chat.forceAccess !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceReview !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceModel !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceReasoning !== appChatManualDropdownValue ||
    effectiveAppSettings.chat.forceSpeed !== appChatManualDropdownValue
  const settingsConfiguredModel =
    settingsPanelSettings.chat.forceModel === appChatManualDropdownValue
      ? model
      : settingsPanelSettings.chat.forceModel
  const settingsEffectiveModel = models.some(
    (candidateModel) => candidateModel.id === settingsConfiguredModel
  )
    ? settingsConfiguredModel
    : getDefaultModel(models).id
  const settingsSelectedEffectiveModel = models.find(
    (candidateModel) => candidateModel.id === settingsEffectiveModel
  )
  useEffect(() => {
    if (models.length === 0) return

    let active = true
    queueMicrotask(() => {
      if (!active) return

      setAppSettings((currentSettings) => {
        const currentChatSettings = currentSettings.chat
        let forceModel = currentChatSettings.forceModel
        let forceReasoning = currentChatSettings.forceReasoning
        let forceSpeed = currentChatSettings.forceSpeed

        if (
          forceModel !== appChatManualDropdownValue &&
          !models.some((candidateModel) => candidateModel.id === forceModel)
        ) {
          forceModel = appChatManualDropdownValue
        }

        const configuredForcedModel = forceModel === appChatManualDropdownValue ? model : forceModel
        const configuredForcedProviderModel =
          models.find((candidateModel) => candidateModel.id === configuredForcedModel) ??
          getDefaultModel(models)

        if (
          forceReasoning !== appChatManualDropdownValue &&
          !modelSupportsReasoningEffort(configuredForcedProviderModel, forceReasoning)
        ) {
          forceReasoning = appChatManualDropdownValue
        }

        if (forceSpeed !== appChatManualDropdownValue) {
          const configuredForcedServiceTier =
            forceSpeed === appChatStandardSpeedValue ? null : forceSpeed
          if (
            !modelHasServiceTierOptions(configuredForcedProviderModel) ||
            !modelSupportsServiceTier(configuredForcedProviderModel, configuredForcedServiceTier)
          ) {
            forceSpeed = appChatManualDropdownValue
          }
        }

        if (
          forceModel === currentChatSettings.forceModel &&
          forceReasoning === currentChatSettings.forceReasoning &&
          forceSpeed === currentChatSettings.forceSpeed
        ) {
          return currentSettings
        }

        return {
          ...currentSettings,
          chat: {
            ...currentChatSettings,
            forceModel,
            forceReasoning,
            forceSpeed
          }
        }
      })
    })

    return () => {
      active = false
    }
  }, [model, models])
  const forceAccessOptions: DropdownOption<AppChatDropdownSettings['forceAccess']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the access selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...sandboxModes.map((mode) => ({
      value: mode.id,
      label: mode.label,
      description: mode.description || undefined,
      icon: chatSandboxModeIcons[mode.id]
    }))
  ]
  const forceReviewOptions: DropdownOption<AppChatDropdownSettings['forceReview']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the review mode selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...approvalModes.map((mode) => ({
      value: mode.id,
      label: mode.label,
      description: mode.description || undefined,
      icon: chatApprovalModeIcons[mode.id]
    }))
  ]
  const forceModelOptions: DropdownOption<AppChatDropdownSettings['forceModel']>[] = [
    {
      value: appChatManualDropdownValue,
      label: 'Manual',
      description: 'Use the model selected manually in the chat.',
      icon: <MessageSquare aria-hidden="true" />
    },
    ...models.map((candidateModel) => ({
      value: candidateModel.id,
      label: formatModelLabel(candidateModel.label),
      description: candidateModel.description || undefined,
      icon: <Bot aria-hidden="true" />
    }))
  ]
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
          : formatSelectionLabel(option.label || option.id),
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

  const handleToggleCwdGroup = (groupKey: string): void => {
    if (groupKey === doneGroupKey) {
      setVisibleChatPageCountsByGroup((currentPageCounts) => {
        if (!(groupKey in currentPageCounts)) return currentPageCounts

        const nextPageCounts = { ...currentPageCounts }
        delete nextPageCounts[groupKey]
        return nextPageCounts
      })
    }

    const nextGroups = {
      ...collapsedCwdGroups,
      [groupKey]: !getCollapsedGroupState(groupKey, collapsedCwdGroups)
    }
    setCollapsedCwdGroups(nextGroups)
    writeStoredCollapsedProjectGroups(nextGroups)
  }

  const handleToggleChatGrouping = (): void => {
    setChatGroupingPreference((currentPreference) => {
      const nextPreference = currentPreference === 'grouped' ? 'ungrouped' : 'grouped'
      writeChatGroupingPreference(nextPreference)
      return nextPreference
    })
  }

  const handleLoadMoreChatsInGroup = (group: ChatListGroupData): void => {
    setVisibleChatPageCountsByGroup((currentPageCounts) => ({
      ...currentPageCounts,
      [group.key]: (currentPageCounts[group.key] ?? 1) + 1
    }))
  }

  const handleShowLessChatsInGroup = (group: ChatListGroupData): void => {
    setVisibleChatPageCountsByGroup((currentPageCounts) => {
      const nextPageCounts = { ...currentPageCounts }
      delete nextPageCounts[group.key]
      return nextPageCounts
    })
  }

  const handleCwdNotesChange = (
    group: Pick<ChatListGroupData, 'key' | 'cwd'>,
    notes: ProviderCwdNote[]
  ): void => {
    setCwdNotesByGroup((currentNotes) => ({
      ...currentNotes,
      [group.key]: notes
    }))

    void providerApi
      .setCwdNotes('codex', group.cwd, notes)
      .then((storedNotes) => {
        setCwdNotesByGroup((currentNotes) => ({
          ...currentNotes,
          [group.key]: storedNotes
        }))
      })
      .catch(() => {
        // Keep the optimistic note list visible if local persistence fails.
      })
  }

  const handleSelectProjectIcon = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'cwd') return

    let icon: AppProjectIcon | null = null
    try {
      icon = await appApi.selectProjectIcon({ cwd: group.cwd })
    } catch {
      return
    }
    if (!icon) return

    setProjectIconsByGroup((currentIcons) => ({
      ...currentIcons,
      [group.key]: icon
    }))

    if (group.cwd) {
      void appApi
        .addProject({ cwd: group.cwd, icon: 'image' })
        .then((project) =>
          setProjects((currentProjects) => mergeProjects(currentProjects, [project]))
        )
        .catch(() => {})
    }
  }

  const handleSelectChat = (chat: ProviderChat): void => {
    const selectingCurrentChat =
      selectedChat?.providerId === chat.providerId && selectedChat.id === chat.id
    const seenUpdatedAt = chat.updatedAt
    const cachedDetail = getRecentCachedChatDetail(chat)
    const seenChat = {
      ...chat,
      seenUpdatedAt:
        chat.seenUpdatedAt == null ? seenUpdatedAt : Math.max(chat.seenUpdatedAt, seenUpdatedAt)
    }

    resetChatSearch()
    setCommitChatReturnTarget(null)
    subagentChatLoadRequestRef.current += 1
    setSubagentChatView(null)
    setSendState(sendInFlightRef.current ? 'sending' : 'idle')
    setEditingMessage(null)
    setNewChatOpen(false)
    setSearchOpen(false)
    setSearchQuery('')

    if (selectingCurrentChat && chatLoadState === 'ready' && chatDetail?.id === chat.id) {
      markSelectedChatSeen()
      return
    }

    markSelectedChatSeen(true)
    recentlyViewedActiveChatPreviewsRef.current.delete(getChatKey(chat))
    selectedChatKeyRef.current = getChatKey(chat)
    selectedChatUpdatedAtRef.current = chat.updatedAt
    chatDetailRef.current = null
    setSelectedChat(seenChat)
    setChatDetail(null)
    setChatLoadState('loading')
    if (cachedDetail) {
      const nextCachedDetail = {
        ...cachedDetail,
        seenUpdatedAt:
          cachedDetail.seenUpdatedAt == null
            ? seenUpdatedAt
            : Math.max(cachedDetail.seenUpdatedAt, seenUpdatedAt)
      }
      chatDetailRef.current = nextCachedDetail
      startTransition(() => {
        setChatDetail(nextCachedDetail)
        setChatLoadState('ready')
      })
    }
    markChatSeenAt(chat.providerId, chat.id, seenUpdatedAt)

    if (selectingCurrentChat && !cachedDetail) {
      setChatLoadRequest((currentRequest) => currentRequest + 1)
    }
  }

  const handleBack = (): void => {
    if (activeSubagentChatView) {
      handleReturnFromSubagentChat()
      return
    }

    markSelectedChatSeen(true)
    setCommitChatReturnTarget(null)
    subagentChatLoadRequestRef.current += 1
    setSubagentChatView(null)
    selectedChatKeyRef.current = null
    selectedChatUpdatedAtRef.current = null
    resetChatSearch()
    chatDetailRef.current = null
    setSelectedChat(null)
    setChatDetail(null)
    setNewChatOpen(false)
    setSendState(sendInFlightRef.current ? 'sending' : 'idle')
    setEditingMessage(null)
  }

  const handleNewChat = (): void => {
    const currentChat = selectedChat
      ? chatDetail?.id === selectedChat.id
        ? chatDetail
        : selectedChat
      : null
    const projectCwd = currentChat ? getChatProjectCwd(currentChat) : undefined
    const projectContainer = currentChat?.container ?? undefined
    markSelectedChatSeen(true)
    selectedChatKeyRef.current = null
    selectedChatUpdatedAtRef.current = null
    subagentChatLoadRequestRef.current += 1
    setSubagentChatView(null)
    showNewChatView(projectCwd, projectContainer)
  }

  const handleNewChatInCwd = (group: ChatListGroupData): void => {
    if (group.kind !== 'cwd') return

    markSelectedChatSeen(true)
    selectedChatKeyRef.current = null
    selectedChatUpdatedAtRef.current = null
    subagentChatLoadRequestRef.current += 1
    setSubagentChatView(null)
    showNewChatView(group.cwd)
  }

  const handleCloseSearch = (): void => {
    setSearchOpen(false)
    setSearchQuery('')
  }

  const handleChatSearchNavigation = (direction: -1 | 1): void => {
    const matches = chatSearchMatchesRef.current
    if (matches.length === 0) return

    const activeIndex =
      (chatSearchActiveIndexRef.current + direction + matches.length) % matches.length
    chatSearchActiveIndexRef.current = activeIndex
    setChatSearchActiveIndex(activeIndex)
    setChatSearchHighlights(matches, activeIndex)
    chatAutoScrollEnabledRef.current = false
    chatAutoScrollTargetRef.current = null

    const activeMatch = matches[activeIndex]
    const scrollContainer = contentRef.current
    if (activeMatch && scrollContainer) {
      scrollChatSearchMatchIntoView(activeMatch, scrollContainer)
    }
  }

  const {
    getSettingsFieldClassName,
    handleActionsChange,
    handleAppearanceControlStyleChange,
    handleAppearanceFontFamilyChange,
    handleAppearanceFontSizeInputBlur,
    handleAppearanceFontSizeInputChange,
    handleAppearancePositionChange,
    handleAppearanceStyleChange,
    handleAppearanceZoomLevelInputBlur,
    handleAppearanceZoomLevelInputChange,
    handleApprovalModeChange,
    handleBrowserDefaultScaleChange,
    handleBrowserEnabledChange,
    handleBrowserViewChange,
    handleChatDropdownPreferenceChange,
    handleChatForcedDropdownChange,
    handleChatUsageDisplayChange,
    handleCodexRecommendedPluginsChange,
    handleContinuePromptChange,
    handleGitCommitMessageGenerationChange,
    handleGitCommitModelChange,
    handleGitCommitPromptChange,
    handleGitErrorResolutionPromptChange,
    handleGitQuickActionsChange,
    handleGitUntrackedFilesPromptChange,
    handleGitWorktreeChange,
    handleLastActionChange,
    handleMaxChatsRenderedChange,
    handleModelChange,
    handleNeverSuggestProviderUpdate,
    handleNeverSuggestProviderUpdateVersion,
    handlePerformancePreferenceChange,
    handleProjectSaved,
    handleReasoningEffortChange,
    handleRecentChatCacheLimitChange,
    handleRecentlyOpenedFilesLimitChange,
    handleRecentsMessageLimitChange,
    handleSandboxModeChange,
    handleSkipProviderUpdate,
    handleThemePreferenceChange,
    handleUpdateProvider,
    isScopedSettingControlDisabled,
    providerUpdateInProgress,
    rememberProject,
    renderProjectSettingAction
  } = useSettingsController({
    setAppSettings,
    settingsProjectCwd,
    setProjectSettingsByCwd,
    settingsViewIsProject,
    effectiveAppSettings,
    setAppearanceZoomLevelInputDraft,
    setBrowserDefaultScaleInputDraft,
    setAppearanceFontSizeInputDraft,
    settingsProjectOverrides,
    settingsScopeKey,
    updateAppearanceZoomLevel,
    settingsPanelSettings,
    recentChatCacheLimitRef,
    recentChatCacheRef,
    selectedChat,
    chatDetail,
    cacheRecentChatDetail,
    newSessionProvider,
    newSessionContainerKey,
    setProjects,
    setNewSessionCwd,
    setProjectDialogOpen,
    setProjectIconsByGroup,
    modelManuallySelectedRef,
    setModel,
    models,
    setReasoningEffort,
    reasoningManuallySelectedRef,
    sandboxMode,
    approvalModeManuallySelectedRef,
    setApprovalMode,
    sandboxModeManuallySelectedRef,
    approvalModeBeforeFullAccessRef,
    approvalMode,
    setSandboxMode,
    setProviderUpdatePreferences,
    setProviderUpdateSuggestion,
    setProviderUpdateError,
    providerUpdateSuggestion,
    providerUpdateState,
    setProviderUpdateState,
    newSessionContainer,
    setProviderModelsRevision,
    providerUpdatePreferences
  })
  const requestErrorVisible = sendState === 'error'
  const requestErrorSummary =
    sendState === 'error' && sendError ? sendError : 'Unable to complete request.'

  const handleSendFailure = useCallback((error: unknown, fallback: string): void => {
    setSendError(getErrorMessage(error, fallback))
    setSendState('error')
  }, [])

  const handleDismissSendError = (): void => {
    setSendState('idle')
    setSendError(null)
  }

  const {
    handleMarkChatDone,
    handleMarkCwdChatsDone,
    handleProjectDragStart,
    handleProjectDrop,
    handleProjectStackDragOver,
    handleRenameChat,
    handleReorderChats,
    handleToggleChatPinned,
    handleUnpinPinnedChats,
    restoreExpandedProjectsAfterDrag
  } = useChatListController({
    applyChatMetadata,
    removeRecentChatCacheEntry,
    selectedChat,
    chatDetail,
    showNewChatView,
    newSessionContainer,
    applyChatDetail,
    chatOrderMutationsRef,
    setChats,
    projectCollapseFrameRef,
    expandedProjectGroupsBeforeDragRef,
    draggedProjectGroupKeyRef,
    projectDropInsertionIndexRef,
    setDraggedProjectGroupKey,
    setProjectDropInsertionIndex,
    activeChatGroups,
    setCollapsedCwdGroups,
    projectOrderMutationRef,
    projects,
    setProjects,
    chatGroupingPreference,
    searchTerms,
    collapsedCwdGroups
  })

  const {
    getGitTurnOptions,
    handleCancelEditMessage,
    handleCancelWorktreeCreation,
    handleContinueStoppedTurn,
    handleDeletePendingMessage,
    handleEditMessage,
    handleEditPendingMessage,
    handleInterruptPendingMessage,
    handleLoadWorkingItem,
    handleLoadWorkingStep,
    handleLoadWorkingToolPage,
    handleResolveApproval,
    handleResolveChatApproval,
    handleRetryStoppedTurn,
    handleSendMessage,
    handleSteerPendingMessage,
    handleStopChat,
    resolveSelectedUserInput
  } = useChatMessagingController({
    chatDetail,
    sendInFlightRef,
    setSendState,
    setEditingMessage,
    selectedChatId,
    models,
    changesProjectCwd,
    projectRecordsByCwd,
    agentMode: effectiveAgentMode,
    effectiveApprovalMode,
    effectiveSandboxMode,
    changesContainer,
    changesCwd,
    effectiveModel,
    selectedEffectiveModel,
    effectiveReasoningEffort,
    effectiveServiceTier,
    effectiveAppSettings,
    configProviderId,
    configProviderContainerKey,
    worktreeCreationCanceledRef,
    setWorktreeCreationState,
    worktreeBranchGenerationRef,
    providerUpdateInProgress,
    activeSubagentChatView,
    selectedChat,
    newSessionCwd,
    sendInFlightProjectKeyRef,
    setSendInFlightProjectKey,
    chatAutoScrollEnabledRef,
    setChatAtConversationBottom,
    scrollToLatestTurnAfterRenderRef,
    editingMessage,
    applyViewedChatDetail,
    handleSendFailure,
    newSessionProvider,
    newSessionLocation,
    defaultCwd,
    rememberProject,
    chatHasActiveTurn: isActiveChatStatus(chatDetail?.status),
    applyChatSummary,
    markChatSeenAt,
    selectedChatKeyRef,
    setContinuedStoppedWorkingStepsByChat,
    runPromptActionRef,
    selectedChatRef,
    chatDetailRef,
    loadedWorkingStepIdsRef,
    setChatDetail,
    selectedProviderId,
    approvalResolution,
    setApprovalResolution,
    applyChatDetail,
    pendingApproval,
    approvalDecisionInFlight,
    pendingUserInput,
    userInputResolving,
    setUserInputResolution,
    sendState
  })

  const {
    chatHasActiveTurn,
    chatHasPendingSteeringMessage,
    chatIsBusy,
    handleChatContentScroll,
    handleChatContentWheel,
    handleForkMessage,
    handleQuoteSelectedMessageText,
    renderChatGroup
  } = useChatInteractionController({
    contentRef,
    chatTurnWindowRef,
    chatScrollAdjustmentTargetRef,
    previousChatScrollTopRef,
    chatTurnScrollDirectionRef,
    setChatAtConversationBottom,
    chatViewportAnchorRef,
    chatAutoScrollEnabledRef,
    chatUserScrollIntentRef,
    chatAutoScrollTargetRef,
    scheduleChatAutoScroll,
    chatUserScrollIntentFrameRef,
    searchTerms,
    collapsedCwdGroups,
    effectiveAppSettings,
    visibleChatPageCountsByGroup,
    projectRecordsByCwd,
    projectIconsByGroup,
    activeChatGroups,
    chatGroupingPreference,
    projectDropInsertionIndex,
    selectedChat,
    committingChatKeys,
    latestCommitFinishedAtByChatKey,
    draggedProjectGroupKey,
    projectNamesByCwd,
    handleLoadMoreChatsInGroup,
    handleShowLessChatsInGroup,
    handleMarkChatDone,
    restoreExpandedProjectsAfterDrag,
    handleProjectDragStart,
    handleMarkCwdChatsDone,
    handleNewChatInCwd,
    handleRenameChat,
    handleSelectProjectIcon,
    handleResolveChatApproval,
    handleReorderChats,
    handleSelectChat,
    handleToggleCwdGroup,
    handleToggleChatPinned,
    handleUnpinPinnedChats,
    resolvingApprovalId,
    chatDetail,
    sendState,
    providerUpdateInProgress,
    forkInFlightRef,
    setSendState,
    setSendError,
    setForkingMessageId,
    applyViewedChatDetail,
    handleSendFailure,
    setMessageBoxQuoteRequest,
    runPromptActionRef,
    handleSendMessage
  })

  const {
    canEditOwnMessages,
    canRetryStoppedTurns,
    chatCommitMarkersByAfterItemId,
    chatCommitMarkersByBeforeItemId,
    chatItemIndexesById,
    continuedStoppedWorkingStepIds,
    displayedRecentChatReferences,
    effectiveChatTurnWindow,
    firstPendingChatItemId,
    followingWorkingStepsById,
    handleNativeChatContentScroll,
    handleNativeChatContentWheel,
    loadChatTurnPage,
    messageBoxContextUsage,
    messageBoxDisabled,
    messageBoxProviderAvailable,
    pinnedChatMessageIds,
    recentlyOpenedFiles,
    renderedChatTurns,
    stoppedTurnActionDisabled,
    stoppedTurnRetryMessages,
    streamingChatItemId,
    subagentChatConversationModel,
    subagentChatItemIndexesById,
    subagentMarkersByWorkingStepId,
    subagentVisibleChatItems,
    trailingChatCommitMarkers,
    visibleChatItems,
    workingStepIdsWithNextWorkingStep
  } = useConversationViewModel({
    selectedChat,
    newSessionProviderAvailable,
    providerUpdateInProgress,
    chatLoadState,
    activeSubagentChatView,
    chatHasActiveTurn,
    chatDetail,
    sendState,
    editingMessage,
    selectedChatSubagents,
    effectiveAppSettings,
    selectedChatId,
    selectedChatKey,
    recentChatReferencePage,
    recentChatReferencesCache,
    pinnedRecentChatReferences,
    recentlyOpenedFilesByWorkspace,
    recentlyOpenedFilesWorkspaceKey,
    changesPaneView,
    selectedProviderId,
    setRecentChatReferencePage,
    setRecentChatReferencesCache,
    chatTurnWindow,
    chatAtConversationBottom,
    pendingPinnedMessageNavigationRef,
    scrollPinnedChatMessageIntoView,
    chatTurnPageLoadRequestRef,
    chatTurnPageLoadInFlightRef,
    chatTurnScrollDirectionRef,
    setChatTurnPageLoadDirection,
    chatTurnWindowRef,
    setChatTurnWindow,
    chatAutoScrollEnabledRef,
    scrollToLatestTurnAfterRenderRef,
    pendingChatScrollAnchorRef,
    contentRef,
    chatScrollAdjustmentTargetRef,
    chatViewportAnchorRef,
    scrollChatContentToBottom,
    selectedChatRef,
    selectedChatKeyRef,
    applyViewedChatDetail,
    chatAutoScrollTargetRef,
    setChatDetail,
    chatDetailRef,
    handleChatContentScroll,
    handleChatContentWheel,
    continuedStoppedWorkingStepsByChat,
    selectedChatCommitMarkers
  })
  const chatPanelOpen = Boolean(selectedChat) || newChatOpen
  const {
    branchNames,
    changedFiles,
    changesLoadState,
    currentBranchName,
    displayedGitChangeLoadError,
    fileEditorDiffTargets,
    filesLoadState,
    hasSyncChanges,
    hasUnpulledChanges,
    hasUnpushedChanges,
    patchChangeSourceSelected,
    primarySyncAction,
    repositoryFiles,
    syncButtonTitle,
    uncommittedChangedFiles,
    unpulledCount,
    unpushedCount,
    untrackedFilesHiddenForPerformance,
    visibleChangesLoadState,
    visibleFilesLoadState,
    visibleGitChangeLoadError
  } = useChangesData({
    changeSource,
    visibleChatItems,
    uncommittedPatchFilter,
    changesContainerKey,
    changesCwd,
    uncommittedPatchFilterError,
    setCachedPatchChangedFiles,
    gitChangesScope,
    gitAvailabilityScopeKey,
    gitChanges,
    fileTreeScope,
    fileTree,
    changesProjectCwd,
    gitChangeLoadScope,
    gitChangeLoadError,
    uncommittedPatchFilterState,
    gitChangeLoadState,
    gitChangeLoadErrorDismissed,
    fileTreeLoadScope,
    fileTreeLoadState,
    cachedPatchChangedFiles,
    changesContainer,
    gitBranchesScope,
    gitBranches,
    changesPaneView,
    selectedChat
  })
  const newSessionLocationOptions = useMemo<DropdownOption<NewSessionLocation>[]>(
    () => [
      {
        value: 'folder',
        label: 'Folder',
        icon: <FolderKanban aria-hidden="true" />
      },
      {
        value: 'worktree',
        label: 'Worktree',
        menuLabel: currentBranchName ? `Worktree · ${currentBranchName}` : 'Worktree',
        icon: <GitBranch aria-hidden="true" />
      }
    ],
    [currentBranchName]
  )

  const {
    activeSidebarLoadState,
    activeTreeFolderPaths,
    aiCommitInstructions,
    branchSwitchDisabled,
    changeTree,
    changesEmptyMessage,
    commitDisabled,
    commitInputLabel,
    commitInputValue,
    commitMessageGenerationDisabled,
    commitMessageGenerationInProgress,
    currentProjectCommitError,
    currentProjectKey,
    currentProjectSyncError,
    directProjectCommitInProgress,
    filesEmptyMessage,
    getAiCommitActionDisabled,
    getChangeTreeRowStyle,
    getCommitActionDisabled,
    gitAiResolutionDisabled,
    gitCommitModeToggle,
    hasCollapsedActiveTreeFolders,
    projectCommitInProgress,
    pushAfterCommit,
    refreshSidebarLabel,
    repositoryFileTree,
    showCommitInput,
    showManualCommit,
    syncDisabled,
    syncDropdownActions,
    syncInProgress,
    treeToggleLabel,
    untrackedFilesAiDisabled,
    visibleSyncRecovery,
    visibleSyncRecoveryActions
  } = useGitViewModel({
    commitInput,
    effectiveAppSettings,
    gitCommitMode,
    changesProjectCwd,
    changesCwd,
    visibleGitErrorProjectKeyRef,
    setCommitErrorsByProjectKey,
    setSyncErrorsByProjectKey,
    setSyncRecoveriesByProjectKey,
    syncProjectKeys,
    syncErrorsByProjectKey,
    syncRecoveriesByProjectKey,
    commitMessageGenerationProjectKeys,
    commitErrorsByProjectKey,
    scopedCommitActivities,
    directCommitActivities,
    startingScopedCommitActivities,
    sendState,
    sendInFlightProjectKey,
    editingMessage,
    selectedChat,
    chatDetail,
    chatLoadState,
    chatIsBusy,
    changedFiles,
    untrackedFilesHiddenForPerformance,
    providerUpdateInProgress,
    changesLoadState,
    uncommittedChangedFiles,
    gitAvailableForCurrentSource,
    setGitCommitMode,
    gitBranchActionState,
    hasUnpulledChanges,
    unpulledCount,
    handleSyncChanges: (...args) => handleSyncChanges(...args),
    hasUnpushedChanges,
    unpushedCount,
    chatHasActiveTurn,
    newSessionProviderAvailable,
    changeSource,
    repositoryFiles,
    lastOpenedFileTreeFolderPath,
    changesPaneView,
    collapsedFileTreeFolders,
    collapsedChangeTreeFolders,
    filesLoadState
  })

  const {
    handleCloseFileEditor,
    handleContinueReview,
    handleDeleteBranch,
    handleDeleteBranchWorktree,
    handleDismissGitBranchError,
    handleForceDeleteBranch,
    handleGoToPinnedText,
    handleOpenAttachment,
    handleOpenFileLink,
    handleReorderPinnedRecentReferences,
    handleReviewCommentsChange,
    handleSelectFileEditorTarget,
    handleSelectedReviewChange,
    handleSwitchBranch,
    handleToggleActiveTreeFolders,
    handleToggleChatMessagePinned,
    handleToggleRecentReferencePinned,
    handleUnpinAllRecentReferences,
    renderChangeTreeNode,
    renderRepositoryFileTreeNode
  } = useFileNavigationController({
    setCollapsedChangeTreeFolders,
    collapsedFileTreeFolders,
    setLastOpenedFileTreeFolderPath,
    setCollapsedFileTreeFolders,
    changesCwd,
    lastOpenedFileTreeFolderByCwdRef,
    collapsedFileTreeFoldersByCwdRef,
    branchSwitchDisabled,
    gitBranchRequestIdRef,
    setGitBranchActionState,
    setGitBranchError,
    setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry,
    changesContainer,
    setGitBranches,
    setGitBranchesScope,
    gitAvailabilityScopeKey,
    setGitBranchLoadState,
    setGitChangeLoadRequest,
    setFileTreeLoadRequest,
    gitBranchDeleteRetry,
    gitBranchWorktreeDeleteRetry,
    gitBranchActionState,
    activeTreeFolderPaths,
    hasCollapsedActiveTreeFolders,
    changesPaneView,
    setFileEditorTarget,
    setRecentlyOpenedFilesByWorkspace,
    selectedChatKey,
    setPinnedRecentChatReferences,
    selectedChatRef,
    handleChangesPaneViewChange,
    selectedChatKeyRef,
    pendingPinnedMessageNavigationRef,
    scrollPinnedChatMessageIntoView,
    chatDetailRef,
    chatTurnPageLoadRequestRef,
    chatTurnPageLoadInFlightRef,
    chatTurnScrollDirectionRef,
    pendingChatScrollAnchorRef,
    chatViewportAnchorRef,
    chatAutoScrollEnabledRef,
    chatAutoScrollTargetRef,
    chatTurnWindowRef,
    setChatTurnPageLoadDirection,
    setChatAtConversationBottom,
    setChatDetail,
    setChatTurnWindow,
    setReviewCommentsDraft,
    setSelectedReview,
    getChangeTreeRowStyle,
    collapsedChangeTreeFolders
  })

  const hasAiCommitInProgressForProject = (projectKey: string): boolean =>
    Boolean(startingScopedCommitActivitiesRef.current[projectKey]) ||
    Object.values(scopedCommitActivitiesRef.current).some(
      (activity) => getChatCwdGroupKey(activity.projectCwd) === projectKey
    )

  const {
    handleDismissGitChangeLoadError,
    handleDismissGitCommitError,
    handleDismissGitSyncRecovery,
    handleDismissUnclassifiedGitSyncError,
    handleGitAiResolution,
    handleGitBranchErrorAiResolution,
    handleGitChangeLoadErrorAiResolution,
    handleGitCommitErrorAiResolution,
    handleGitSyncRecoveryAction,
    handleSolveUntrackedFiles,
    handleSyncChanges,
    handleUnclassifiedGitSyncAiResolution,
    renderGitAiResolutionButton,
    runSyncChanges
  } = useGitSyncController({
    setSyncErrorsByProjectKey,
    setSyncRecoveriesByProjectKey,
    providerUpdateInProgress,
    changesProjectCwd,
    syncProjectKeysRef,
    hasAiCommitInProgressForProject,
    commitInFlightProjectKeysRef,
    commitMessageGenerationProjectKeysRef,
    setSyncProjectKeys,
    changesContainer,
    setGitChangeLoadRequest,
    syncDisabled,
    changesCwd,
    currentProjectKey,
    visibleSyncRecovery,
    syncInProgress,
    visibleGitChangeLoadError,
    effectiveAppSettings,
    gitAiResolutionDisabled,
    handleSendMessage,
    getGitTurnOptions,
    setGitChangeLoadErrorDismissed,
    setCommitErrorsByProjectKey,
    currentProjectSyncError,
    currentProjectCommitError,
    gitBranchError,
    setGitBranchError,
    setGitBranchDeleteRetry,
    setGitBranchWorktreeDeleteRetry,
    gitBranchActionState,
    setGitBranchActionState,
    configProviderId,
    untrackedFilesHiddenForPerformance,
    untrackedFilesAiDisabled
  })

  const {
    handleAiCommitChangedFiles,
    handleCancelAiCommit,
    handleGenerateCommitMessage,
    handleManualCommitChangedFiles,
    handleOpenAiCommitChat,
    handleQuickCommitChangedFiles,
    handleReturnFromAiCommitChat
  } = useCommitController({
    startingScopedCommitActivitiesRef,
    scopedCommitActivitiesRef,
    providerUpdateInProgress,
    selectedChat,
    chatDetail,
    changesCwd,
    newSessionProvider,
    changesProjectCwd,
    projectCommitInProgress,
    commitInFlightProjectKeysRef,
    commitMessageGenerationProjectKeysRef,
    syncProjectKeysRef,
    sendInFlightRef,
    sendInFlightProjectKeyRef,
    getGitTurnOptions,
    setStartingScopedCommitActivities,
    chatAutoScrollEnabledRef,
    setCommitErrorsByProjectKey,
    setChatCommitMarkers,
    applyChatDetail,
    changesCwdRef,
    setCommitInput,
    setScopedCommitActivities,
    commitMessageGenerationDisabled,
    setCommitMessageGenerationProjectKeys,
    changesContainer,
    effectiveAppSettings,
    aiCommitInstructions,
    commitInputValue,
    getCommitActionDisabled,
    setDirectCommitActivities,
    patchChangeSourceSelected,
    changedFiles,
    setGitChangeLoadRequest,
    pushAfterCommit,
    runSyncChanges,
    getAiCommitActionDisabled,
    cancelingAiCommitKeys,
    setCancelingAiCommitKeys,
    openingAiCommitChatIds,
    chatsRef,
    setOpeningAiCommitChatIds,
    markSelectedChatSeen,
    setSendState,
    setEditingMessage,
    setSearchOpen,
    setSearchQuery,
    subagentChatLoadRequestRef,
    setSubagentChatView,
    setCommitChatReturnTarget,
    applyViewedChatDetail,
    commitChatReturnTarget,
    handleSelectChat,
    hasAiCommitInProgressForProject
  })

  const { handleReturnFromSubagentChat, renderChatCommitMarker, renderChatSubagentMarker } =
    useSubagentController({
      selectedProviderId,
      selectedChatId,
      selectedChatKey,
      subagentChatLoadRequestRef,
      resetChatSearch,
      setEditingMessage,
      setSubagentChatView,
      selectedChatKeyRef,
      subagentContentRef,
      scrollChatContentToBottom,
      cancelingSubagentIds,
      setCancelingSubagentIds,
      setSubagentListState,
      contentRef,
      scopedCommitActivitiesByMarkerId,
      providerUpdateInProgress,
      cancelingAiCommitKeys,
      openingAiCommitChatIds,
      handleCancelAiCommit,
      handleOpenAiCommitChat
    })

  const handleMinimizeWindow = (): void => {
    void appApi.minimizeWindow()
  }

  const handleToggleWindowMaximized = (): void => {
    void appApi
      .toggleWindowMaximized()
      .then((nextWindowState) => setWindowState(nextWindowState))
      .catch(() => {})
  }

  const handleCloseWindow = (): void => {
    void appApi.closeWindow()
  }

  const settingsProjectLabel = settingsProjectCwd ? getFolderName(settingsProjectCwd) : 'Project'
  const appearanceZoomLevelInput =
    appearanceZoomLevelInputDraft?.key === settingsScopeKey
      ? appearanceZoomLevelInputDraft.value
      : String(appAppearanceZoomLevelToPercent(settingsPanelSettings.appearance.zoomLevel))
  const browserDefaultScaleInput =
    browserDefaultScaleInputDraft?.key === settingsScopeKey
      ? browserDefaultScaleInputDraft.value
      : String(settingsPanelSettings.browser.defaultScale)
  const windowControlsHidden = settingsPanelSettings.appearance.position === 'hidden'

  const settingsPanelProps: SettingsPanelProps = {
    appearanceFontSizeInputDraft,
    appearanceZoomLevelInput,
    browserDefaultScaleInput,
    changesContainer,
    changesContainerKey,
    containerOptions,
    forceAccessOptions,
    forceModelOptions,
    forceReasoningOptions,
    forceReviewOptions,
    forceSpeedOptions,
    getSettingsFieldClassName,
    gitCommitModelOptions,
    gitCommitModelValue,
    gitSettingsModelCatalogLoading,
    gitSettingsModelsCurrent,
    gitSettingsModelsReady,
    handleAppearanceControlStyleChange,
    handleAppearanceFontFamilyChange,
    handleAppearanceFontSizeInputBlur,
    handleAppearanceFontSizeInputChange,
    handleAppearancePositionChange,
    handleAppearanceStyleChange,
    handleAppearanceZoomLevelInputBlur,
    handleAppearanceZoomLevelInputChange,
    handleBrowserDefaultScaleChange,
    handleBrowserEnabledChange,
    handleBrowserViewChange,
    handleChatDropdownPreferenceChange,
    handleChatForcedDropdownChange,
    handleChatUsageDisplayChange,
    handleCodexRecommendedPluginsChange,
    handleContinuePromptChange,
    handleDeleteProviderAccount,
    handleGitCommitMessageGenerationChange,
    handleGitCommitModelChange,
    handleGitCommitPromptChange,
    handleGitErrorResolutionPromptChange,
    handleGitQuickActionsChange,
    handleGitUntrackedFilesPromptChange,
    handleGitWorktreeChange,
    handleMaxChatsRenderedChange,
    handleNewSessionContainerChange,
    handlePerformancePreferenceChange,
    handleProviderAppEnabledChange,
    handleProviderSkillEnabledChange,
    handleProviderSkillsEnabledChange,
    handleRecentChatCacheLimitChange,
    handleRecentlyOpenedFilesLimitChange,
    handleRecentsMessageLimitChange,
    handleThemePreferenceChange,
    handleUseProviderAccount,
    installedFontFamilies,
    installedFontOptions,
    installedFontsLoaded,
    isScopedSettingControlDisabled,
    newSessionContainerValue,
    newSessionProvider,
    newSessionProviderOptions,
    newSessionProviderValueContent,
    newSessionSourceAvailabilityReady,
    providerAccountUpdatingId,
    providerAccountsError,
    providerAccountsLoadState,
    providerResourceUpdatingKey,
    providerResourcesError,
    providerResourcesLoadState,
    renderProjectSettingAction,
    setAccountDialogOpen,
    setBrowserDefaultScaleInputDraft,
    setEditingSshEnvironment,
    setNewSessionProvider,
    setProviderAccountsRefresh,
    setProviderResourcesRefresh,
    setSshEnvironmentDialogOpen,
    setSshEnvironmentError,
    settingsPanelSettings,
    settingsProviderAccounts,
    settingsProviderApps,
    settingsProviderSkills,
    settingsScopeKey,
    settingsTab,
    sshEnvironmentError,
    windowControlsHidden
  }

  const renderWindowControls = (placement: 'darwin' | 'default'): React.ReactElement | null =>
    windowControlsHidden ? null : (
      <div className={`window-controls window-controls--${placement}`} aria-label="Window controls">
        <button
          className="window-control window-control--minimize"
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={handleMinimizeWindow}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          className="window-control window-control--maximize"
          type="button"
          aria-label={windowState.isMaximized ? 'Restore' : 'Maximize'}
          title={windowState.isMaximized ? 'Restore' : 'Maximize'}
          onClick={handleToggleWindowMaximized}
        >
          {windowState.isMaximized ? (
            <Minimize2 aria-hidden="true" />
          ) : (
            <Maximize2 aria-hidden="true" />
          )}
        </button>
        <button
          className="window-control window-control--close"
          type="button"
          aria-label="Close"
          title="Close"
          onClick={handleCloseWindow}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    )

  const chromeControlTheme: 'transparent' | 'secondary' =
    effectiveAppSettings.appearance.controlStyle === 'transparent' ? 'transparent' : 'secondary'

  const renderSettingsButton = (): React.ReactElement => (
    <Button
      theme={chromeControlTheme}
      aria-label="Settings"
      title="Settings"
      callback={() => setSettingsOpen(true)}
      icon={<Settings aria-hidden="true" />}
    />
  )

  const renderChatGroupingButton = (): React.ReactElement => {
    const nextPreference = chatGroupingPreference === 'grouped' ? 'ungrouped' : 'grouped'

    return (
      <Button
        theme={chromeControlTheme}
        aria-label={`Chat grouping: ${chatGroupingPreference}. Switch to ${nextPreference}`}
        aria-pressed={chatGroupingPreference === 'grouped'}
        title={chatGroupingPreference === 'grouped' ? 'Grouped' : 'Ungrouped'}
        callback={handleToggleChatGrouping}
        icon={
          chatGroupingPreference === 'grouped' ? (
            <FolderTree aria-hidden="true" />
          ) : (
            <LayoutList aria-hidden="true" />
          )
        }
      />
    )
  }

  const renderChatTurn = (turnIndex: number, turn: ProviderChatTurn): React.ReactElement => {
    const turnIsLatestRendered = turn === renderedChatTurns.at(-1)

    return (
      <div
        className="chat-detail__turn"
        data-chat-turn-id={turn.id}
        data-chat-turn-index={turnIndex}
        key={turn.id}
      >
        {turn.items.map((item) => {
          const itemIndex = chatItemIndexesById.get(item.id) ?? -1
          const followingWorkingStep = followingWorkingStepsById.get(item.id)

          return (
            <Fragment key={item.id}>
              {chatCommitMarkersByBeforeItemId.get(item.id)?.map(renderChatCommitMarker)}
              {item.id === firstPendingChatItemId &&
                trailingChatCommitMarkers.map(renderChatCommitMarker)}
              <ChatDetailItem
                availableRateLimitResets={
                  item.type === 'working' && item.failureReason === 'rateLimit'
                    ? (accountUsage?.rateLimitResetCredits?.availableCount ?? 0)
                    : 0
                }
                canEditOwnMessages={canEditOwnMessages}
                container={changesContainer}
                continuePrompt={effectiveAppSettings.chat.continuePrompt}
                continueStoppedTurnDisabled={stoppedTurnActionDisabled}
                continuedStoppedTurn={continuedStoppedWorkingStepIds.has(item.id)}
                followingWorkingStepHasNext={followingWorkingStep?.hasNextWorkingStep}
                followingWorkingStepStatus={followingWorkingStep?.status}
                hasNextWorkingStep={workingStepIdsWithNextWorkingStep.has(item.id)}
                item={item}
                messagePinned={item.type === 'message' && pinnedChatMessageIds.has(item.id)}
                cwd={changesCwd}
                modelLabelsById={modelLabelsById}
                onDeletePendingMessage={handleDeletePendingMessage}
                onEditPendingMessage={handleEditPendingMessage}
                onSteerPendingMessage={
                  chatHasActiveTurn && !chatHasPendingSteeringMessage
                    ? handleSteerPendingMessage
                    : undefined
                }
                onInterruptPendingMessage={handleInterruptPendingMessage}
                onContinueStoppedTurn={
                  item.type === 'working' && item.status === 'stopped'
                    ? handleContinueStoppedTurn
                    : undefined
                }
                onEditMessage={handleEditMessage}
                onForkMessage={
                  chatHasActiveTurn || forkingMessageId ? undefined : handleForkMessage
                }
                onLoadWorkingStep={handleLoadWorkingStep}
                onLoadWorkingItem={handleLoadWorkingItem}
                onLoadWorkingToolPage={handleLoadWorkingToolPage}
                onDisclosureToggle={handleChatDisclosureToggle}
                onOpenFileLink={changesCwd ? handleOpenFileLink : undefined}
                onToggleMessagePinned={handleToggleChatMessagePinned}
                onRetryStoppedTurn={handleRetryStoppedTurn}
                onUsageRefresh={
                  item.type === 'working' && item.failureReason === 'rateLimit'
                    ? refreshAccountUsage
                    : undefined
                }
                onUsageReset={
                  item.type === 'working' && item.failureReason === 'rateLimit'
                    ? resetAccountRateLimits
                    : undefined
                }
                previousItem={itemIndex > 0 ? visibleChatItems[itemIndex - 1] : null}
                projectCwd={changesProjectCwd}
                retryMessage={canRetryStoppedTurns ? stoppedTurnRetryMessages.get(item.id) : null}
                retryStoppedTurnDisabled={stoppedTurnActionDisabled}
                selectedModelId={model}
                streaming={item.id === streamingChatItemId}
                thoughtSettings={effectiveAppSettings.chat}
                turnIndex={turnIndex}
                workingStepContent={
                  item.type === 'working'
                    ? subagentMarkersByWorkingStepId.get(item.id)?.map(renderChatSubagentMarker)
                    : undefined
                }
              />
              {chatCommitMarkersByAfterItemId.get(item.id)?.map(renderChatCommitMarker)}
            </Fragment>
          )
        })}
        {turnIsLatestRendered &&
          effectiveChatTurnWindow?.endIndex === effectiveChatTurnWindow?.totalCount &&
          !firstPendingChatItemId &&
          trailingChatCommitMarkers.map(renderChatCommitMarker)}
      </div>
    )
  }

  const renderSubagentChatTurn = (
    turnIndex: number,
    turn: ProviderChatTurn
  ): React.ReactElement => (
    <div
      className="chat-detail__turn"
      data-chat-turn-id={turn.id}
      data-chat-turn-index={turnIndex}
      key={turn.id}
    >
      {turn.items.map((item) => {
        const itemIndex = subagentChatItemIndexesById.get(item.id) ?? -1
        const followingWorkingStep = subagentChatConversationModel.followingWorkingStepsById.get(
          item.id
        )

        return (
          <ChatDetailItem
            container={changesContainer}
            followingWorkingStepHasNext={followingWorkingStep?.hasNextWorkingStep}
            followingWorkingStepStatus={followingWorkingStep?.status}
            hasNextWorkingStep={subagentChatConversationModel.workingStepIdsWithNextWorkingStep.has(
              item.id
            )}
            item={item}
            key={item.id}
            cwd={changesCwd}
            modelLabelsById={modelLabelsById}
            onOpenFileLink={changesCwd ? handleOpenFileLink : undefined}
            previousItem={itemIndex > 0 ? subagentVisibleChatItems[itemIndex - 1] : null}
            projectCwd={changesProjectCwd}
            selectedModelId={model}
            thoughtSettings={effectiveAppSettings.chat}
            turnIndex={turnIndex}
          />
        )
      })}
    </div>
  )

  const showChatTurnDownButton = Boolean(
    !activeSubagentChatView &&
    effectiveChatTurnWindow &&
    (!chatAtConversationBottom ||
      effectiveChatTurnWindow.endIndex < effectiveChatTurnWindow.totalCount ||
      Boolean(chatDetail?.turnPagination?.newerCursor))
  )

  return {
    className: `chat${chatPanelOpen ? ' chat--has-selection' : ' chat--no-selection'}`,
    dialogs: {
      settingsCloseButtonRef,
      settingsOpen,
      settingsPanelProps,
      settingsProjectCwd,
      settingsProjectLabel,
      settingsTab,
      settingsViewIsProject,
      setSettingsOpen,
      setAppearanceZoomLevelInputDraft,
      setAppearanceFontSizeInputDraft,
      setSettingsScope,
      setSettingsTab,
      accountDialogOpen,
      setAccountDialogOpen,
      handleCreateProviderAccount,
      projectDialogOpen,
      newSessionCwd,
      projects,
      setProjectDialogOpen,
      handleProjectSaved,
      sshEnvironmentDialogOpen,
      editingSshEnvironment,
      setSshEnvironmentDialogOpen,
      setEditingSshEnvironment,
      handleSaveSshEnvironment,
      fileEditorTarget,
      fileEditorDiffTargets,
      reviewCommentsDraft,
      handleCloseFileEditor,
      handleContinueReview,
      handleReviewCommentsChange,
      handleSelectFileEditorTarget
    },
    layout: {
      changesSidebarExpanded,
      panelsRef,
      panelsStyle,
      resizeHandleRef,
      changesResizeHandleRef,
      handleStartChatResize
    },
    chatSidebar: {
      chats,
      chromeControlTheme,
      displayedActiveChatGroups,
      doneChatGroup,
      filteredChats,
      handleCloseSearch,
      handleNewChat,
      handleProjectDrop,
      handleProjectStackDragOver,
      loadState,
      pinnedChatGroup,
      renderChatGroup,
      renderChatGroupingButton,
      renderSettingsButton,
      renderWindowControls,
      searchInputRef,
      searchOpen,
      searchQuery,
      setSearchOpen,
      setSearchQuery
    },
    conversationHeader: {
      visible: Boolean(selectedChat || newChatOpen),
      handleBack
    },
    conversationSearch: {
      visible: Boolean(selectedChat && chatSearchOpen),
      chatSearchActiveIndex,
      chatSearchInputRef,
      chatSearchMatchCount,
      chatSearchQuery,
      closeChatSearch,
      handleChatSearchNavigation,
      setChatSearchQuery
    },
    conversationMessages: {
      visible: Boolean(selectedChat),
      activeSubagentChatView,
      chatHasActiveTurn,
      chatLoadState,
      chatSearchContentRef,
      chatTurnPageLoadDirection,
      commitChatReturnTarget,
      contentRef,
      editingMessage,
      effectiveChatTurnWindow,
      handleNativeChatContentScroll,
      handleNativeChatContentWheel,
      handleReturnFromAiCommitChat,
      handleReturnFromSubagentChat,
      loadChatTurnPage,
      renderChatTurn,
      renderSubagentChatTurn,
      renderedChatTurns,
      selectedChat,
      selectedChatCommitMarkers,
      selectedChatKey,
      selectedChatSubagents,
      sendState,
      showChatTurnDownButton,
      subagentChatConversationModel,
      subagentContentRef,
      subagentVisibleChatItems,
      visibleChatItems
    },
    conversationComposer: {
      accountUsage,
      accountUsageError,
      accountUsageState,
      activeSubagentChatView,
      agentModes,
      agentModesLoading,
      appSettings,
      approvalDecisionInFlight,
      approvalError,
      approvalModes,
      approvalTypeLabels,
      changesContainer,
      changesCwd,
      changesProjectCwd,
      chatHasActiveTurn,
      chatHasPendingSteeringMessage,
      containerOptions,
      cwdNotesByGroup,
      editingMessage,
      effectiveAppSettings,
      agentMode,
      effectiveApprovalMode,
      effectiveModel,
      effectiveReasoningEffort,
      effectiveSandboxMode,
      effectiveServiceTier,
      getApprovalSummary,
      getProviderUpdateSummary,
      handleActionsChange,
      handleApprovalModeChange,
      handleCancelEditMessage,
      handleCancelWorktreeCreation,
      handleCwdNotesChange,
      handleDismissSendError,
      handleLastActionChange,
      handleModelChange,
      handleNeverSuggestProviderUpdate,
      handleNeverSuggestProviderUpdateVersion,
      handleNewSessionContainerChange,
      handleNewSessionRemoteRuntimeChange,
      handleOpenAttachment,
      handleOpenFileLink,
      handleReasoningEffortChange,
      handleResolveApproval,
      handleRunAction,
      handleSandboxModeChange,
      handleSelectedReviewChange,
      handleSendMessage,
      handleSkipProviderUpdate,
      handleStopChat,
      handleUpdateProvider,
      hasForcedChatDropdown,
      messageBoxContextUsage,
      messageBoxDisabled,
      messageBoxNotesGroup,
      messageBoxProviderAvailable,
      messageBoxQuoteRequest,
      models,
      modelsLoading,
      newChatOpen,
      newSessionContainerValue,
      newSessionCwd,
      newSessionLocation,
      newSessionLocationOptions,
      newSessionProjectValue,
      newSessionProvider,
      newSessionProviderOptions,
      newSessionProviderValueContent,
      newSessionRemoteRuntime,
      newSessionSshEnvironmentId,
      pendingApproval,
      pendingUserInput,
      projectOptions,
      providerResourcesRevision,
      providerUpdateError,
      providerUpdateInProgress,
      providerUpdateState,
      providerUpdateSuggestion,
      refreshAccountUsage,
      remoteContainerSuggestionsError,
      remoteContainerSuggestionsLoading,
      remoteRuntimeOptions,
      requestErrorSummary,
      requestErrorVisible,
      resetAccountRateLimits,
      resolveSelectedUserInput,
      sandboxModes,
      selectedChat,
      selectedChatKey,
      selectedReview,
      sendState,
      setEditingSshEnvironment,
      setAgentMode,
      setNewSessionCwd,
      setNewSessionLocation,
      setNewSessionProvider,
      setProjectDialogOpen,
      setRemoteContainerSuggestionsError,
      setServiceTier,
      setSshEnvironmentDialogOpen,
      setSshEnvironmentError,
      sshEnvironmentError,
      terminalWorkspaceKey,
      userInputError,
      userInputResolving,
      worktreeCreationState
    },
    changesHeader: {
      activeSidebarLoadState,
      activeTreeFolderPaths,
      branchNames,
      branchSwitchDisabled,
      changesCwd,
      changesPaneView,
      changesSidebarExpanded,
      currentBranchName,
      effectiveAppSettings,
      gitBranchActionState,
      gitBranchDeleteRetry,
      gitBranchError,
      gitBranchLoadState,
      gitBranchWorktreeDeleteRetry,
      handleChangesPaneViewChange,
      handleDeleteBranch,
      handleDeleteBranchWorktree,
      handleDismissGitBranchError,
      handleForceDeleteBranch,
      handleGitBranchErrorAiResolution,
      handleSwitchBranch,
      handleToggleActiveTreeFolders,
      hasCollapsedActiveTreeFolders,
      refreshSidebarLabel,
      renderGitAiResolutionButton,
      renderSettingsButton,
      renderWindowControls,
      setChangesSidebarExpanded,
      setFileTreeLoadRequest,
      setGitBranchLoadRequest,
      setGitChangeLoadRequest,
      treeToggleLabel
    },
    changesContent: {
      browserOpenRequest,
      browserOpened,
      browserWorkspaceKey,
      changeTree,
      changedFiles,
      changesContainer,
      changesCwd,
      changesEmptyMessage,
      changesPaneView,
      changesProjectCwd,
      displayedGitChangeLoadError,
      displayedRecentChatReferences,
      effectiveAppSettings,
      filesEmptyMessage,
      handleDismissGitChangeLoadError,
      handleGitChangeLoadErrorAiResolution,
      handleGoToPinnedText,
      handleOpenFileLink,
      handleReorderPinnedRecentReferences,
      handleSolveUntrackedFiles,
      handleToggleRecentReferencePinned,
      handleUnpinAllRecentReferences,
      recentlyOpenedFiles,
      renderChangeTreeNode,
      renderGitAiResolutionButton,
      renderRepositoryFileTreeNode,
      repositoryFileTree,
      repositoryFiles,
      setGitChangeLoadRequest,
      terminalCommandLaunchRequest,
      terminalOpened,
      terminalWorkspaceKey,
      untrackedFilesAiDisabled,
      untrackedFilesHiddenForPerformance,
      visibleChangesLoadState,
      visibleFilesLoadState,
      visibleGitChangeLoadError
    },
    changesFooter: {
      visible: changesPaneView === 'git',
      commitActionLabels,
      commitDisabled,
      commitInput,
      commitInputLabel,
      commitMessageGenerationDisabled,
      commitMessageGenerationInProgress,
      currentProjectCommitError,
      currentProjectKey,
      currentProjectSyncError,
      directProjectCommitInProgress,
      getAiCommitActionDisabled,
      getGitRecoveryActionIcon,
      getGitRecoveryRememberLabel,
      gitCommitModeToggle,
      handleAiCommitChangedFiles,
      handleDismissGitCommitError,
      handleDismissGitSyncRecovery,
      handleDismissUnclassifiedGitSyncError,
      handleGenerateCommitMessage,
      handleGitAiResolution,
      handleGitCommitErrorAiResolution,
      handleGitSyncRecoveryAction,
      handleManualCommitChangedFiles,
      handleQuickCommitChangedFiles,
      handleSyncChanges,
      handleUnclassifiedGitSyncAiResolution,
      hasSyncChanges,
      primarySyncAction,
      projectCommitInProgress,
      providerUpdateInProgress,
      pushAfterCommit,
      renderGitAiResolutionButton,
      setCommitErrorsByProjectKey,
      setCommitInput,
      showCommitInput,
      showManualCommit,
      syncButtonTitle,
      syncDisabled,
      syncDropdownActions,
      syncInProgress,
      unpulledCount,
      unpushedCount,
      visibleSyncRecovery,
      visibleSyncRecoveryActions
    },
    conversationPanel: {
      selectedChat,
      newChatOpen,
      activeSubagentChatView
    },
    conversationQuote: {
      visible: Boolean(selectedChat && !activeSubagentChatView),
      contentRef,
      editingMessage,
      selectedChatKey,
      handleQuoteSelectedMessageText
    },
    conversationEmptyState: {
      visible: Boolean(!selectedChat && newChatOpen)
    },
    conversationPlan: {
      visible: Boolean(!activeSubagentChatView && !effectiveAppSettings.chat.hidePlans),
      selectedChatKey,
      messageBoxPlan
    }
  }
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>
