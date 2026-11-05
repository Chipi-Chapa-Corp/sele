import { useWorkspaceChatCache } from '../features/useWorkspaceChatCache'
import { useWorkspaceProviderContext } from '../features/useWorkspaceProviderContext'
import { useWorkspaceSettingsContext } from '../features/useWorkspaceSettingsContext'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceProjectState } from '../state/useWorkspaceProjectState'
import { useWorkspaceProviderState } from '../state/useWorkspaceProviderState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'
import { useSettingsController } from '../useSettingsController'

type WorkspaceSettingsActionsDependencies = {
  preferences: ReturnType<typeof useWorkspacePreferenceState>
  settings: ReturnType<typeof useWorkspaceSettingsContext>
  chatCache: ReturnType<typeof useWorkspaceChatCache>
  chatState: ReturnType<typeof useWorkspaceChatState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  projectState: ReturnType<typeof useWorkspaceProjectState>
  providerState: ReturnType<typeof useWorkspaceProviderState>
  provider: ReturnType<typeof useWorkspaceProviderContext>
}

export function useWorkspaceSettingsActions({
  preferences,
  settings,
  chatCache,
  chatState,
  sourceState,
  projectState,
  providerState,
  provider
}: WorkspaceSettingsActionsDependencies) {
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
    handleChatDropdownSettingChange,
    handleChatUsageDisplayChange,
    handleCodexRecommendedPluginsChange,
    handleContinuePromptChange,
    handleLinkedChatSummaryPromptChange,
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
    handlePerformancePreferenceChange,
    handleProjectSaved,
    handleReasoningEffortChange,
    handleNetworkRetrySettingChange,
    handleRecentChatCacheLimitChange,
    handleRecentlyOpenedFilesLimitChange,
    handleRecentsMessageLimitChange,
    handleSandboxModeChange,
    handleThemePreferenceChange,
    isScopedSettingControlDisabled,
    renderProjectSettingAction
  } = useSettingsController({
    setAppSettings: preferences.setAppSettings,
    settingsProjectCwd: settings.settingsProjectCwd,
    setProjectSettingsByCwd: preferences.setProjectSettingsByCwd,
    settingsViewIsProject: settings.settingsViewIsProject,
    effectiveAppSettings: settings.effectiveAppSettings,
    setAppearanceZoomLevelInputDraft: preferences.setAppearanceZoomLevelInputDraft,
    setBrowserDefaultScaleInputDraft: preferences.setBrowserDefaultScaleInputDraft,
    setAppearanceFontSizeInputDraft: preferences.setAppearanceFontSizeInputDraft,
    settingsProjectOverrides: settings.settingsProjectOverrides,
    settingsScopeKey: settings.settingsScopeKey,
    updateAppearanceZoomLevel: settings.updateAppearanceZoomLevel,
    settingsPanelSettings: settings.settingsPanelSettings,
    recentChatCacheLimitRef: chatCache.recentChatCacheLimitRef,
    recentChatCacheRef: chatCache.recentChatCacheRef,
    selectedChat: chatState.selectedChat,
    chatDetail: chatState.chatDetail,
    cacheRecentChatDetail: chatCache.cacheRecentChatDetail,
    newSessionProvider: sourceState.newSessionProvider,
    newSessionContainerKey: sourceState.newSessionContainerKey,
    setProjects: projectState.setProjects,
    setDeletedProjectCwds: projectState.setDeletedProjectCwds,
    setNewSessionCwd: sourceState.setNewSessionCwd,
    setProjectDialogOpen: projectState.setProjectDialogOpen,
    setProjectIconsByGroup: projectState.setProjectIconsByGroup,
    modelManuallySelectedRef: providerState.modelManuallySelectedRef,
    setModel: providerState.setModel,
    models: provider.models,
    setReasoningEffort: providerState.setReasoningEffort,
    reasoningManuallySelectedRef: providerState.reasoningManuallySelectedRef,
    sandboxMode: providerState.sandboxMode,
    approvalModeManuallySelectedRef: providerState.approvalModeManuallySelectedRef,
    setApprovalMode: providerState.setApprovalMode,
    sandboxModeManuallySelectedRef: providerState.sandboxModeManuallySelectedRef,
    approvalModeBeforeFullAccessRef: providerState.approvalModeBeforeFullAccessRef,
    approvalMode: providerState.approvalMode,
    setSandboxMode: providerState.setSandboxMode
  })
  return {
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
    handleChatDropdownSettingChange,
    handleChatUsageDisplayChange,
    handleCodexRecommendedPluginsChange,
    handleContinuePromptChange,
    handleLinkedChatSummaryPromptChange,
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
    handlePerformancePreferenceChange,
    handleProjectSaved,
    handleReasoningEffortChange,
    handleNetworkRetrySettingChange,
    handleRecentChatCacheLimitChange,
    handleRecentlyOpenedFilesLimitChange,
    handleRecentsMessageLimitChange,
    handleSandboxModeChange,
    handleThemePreferenceChange,
    isScopedSettingControlDisabled,
    renderProjectSettingAction
  }
}
