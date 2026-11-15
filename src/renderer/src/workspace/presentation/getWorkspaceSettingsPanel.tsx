import { writeChatSidebarTabs } from '../../chatSidebarFilter'
import { type SettingsPanelProps } from '../../components/SettingsPanel'
import { appAppearanceZoomLevelToPercent } from '../../settings'
import { getFolderName } from '../chatControllerUtils'
import { writeChatGroupingPreference } from '../controllerTypes'
import type { WorkspaceChanges } from '../composition/useWorkspaceChangesModel'

export function getWorkspaceSettingsPanel({
  settings,
  preferences,
  accountActions,
  session,
  sourceControls,
  settingsOptions,
  settingsActions,
  gitModels,
  provider,
  projectState,
  chatState,
  resourceActions,
  sourceState,
  providerState,
  chrome
}: WorkspaceChanges) {
  const settingsProjectLabel = settings.settingsProjectCwd
    ? getFolderName(settings.settingsProjectCwd)
    : 'Project'

  const appearanceZoomLevelInput =
    preferences.appearanceZoomLevelInputDraft?.key === settings.settingsScopeKey
      ? preferences.appearanceZoomLevelInputDraft.value
      : String(appAppearanceZoomLevelToPercent(settings.settingsPanelSettings.appearance.zoomLevel))

  const browserDefaultScaleInput =
    preferences.browserDefaultScaleInputDraft?.key === settings.settingsScopeKey
      ? preferences.browserDefaultScaleInputDraft.value
      : String(settings.settingsPanelSettings.browser.defaultScale)

  const settingsPanelProps: SettingsPanelProps = {
    handleProviderConnectionsChanged: accountActions.handleProviderConnectionsChanged,
    appearanceFontSizeInputDraft: preferences.appearanceFontSizeInputDraft,
    appearanceZoomLevelInput,
    browserDefaultScaleInput,
    changesContainer: session.changesContainer,
    changesContainerKey: session.changesContainerKey,
    containerOptions: sourceControls.containerOptions,
    forceAccessOptions: settingsOptions.forceAccessOptions,
    forceModelOptions: settingsOptions.forceModelOptions,
    forceReasoningOptions: settingsOptions.forceReasoningOptions,
    forceReviewOptions: settingsOptions.forceReviewOptions,
    forceSpeedOptions: settingsOptions.forceSpeedOptions,
    getSettingsFieldClassName: settingsActions.getSettingsFieldClassName,
    gitCommitModelOptions: gitModels.gitCommitModelOptions,
    gitCommitModelValue: gitModels.gitCommitModelValue,
    gitSettingsModelCatalogLoading: gitModels.gitSettingsModelCatalogLoading,
    gitSettingsModelsCurrent: gitModels.gitSettingsModelsCurrent,
    gitSettingsModelsReady: provider.gitSettingsModelsReady,
    handleAppearanceControlStyleChange: settingsActions.handleAppearanceControlStyleChange,
    handleAppearanceFontFamilyChange: settingsActions.handleAppearanceFontFamilyChange,
    handleAppearanceFontSizeInputBlur: settingsActions.handleAppearanceFontSizeInputBlur,
    handleAppearanceFontSizeInputChange: settingsActions.handleAppearanceFontSizeInputChange,
    handleAppearancePositionChange: settingsActions.handleAppearancePositionChange,
    handleAppearanceStyleChange: settingsActions.handleAppearanceStyleChange,
    handleAppearanceZoomLevelInputBlur: settingsActions.handleAppearanceZoomLevelInputBlur,
    handleAppearanceZoomLevelInputChange: settingsActions.handleAppearanceZoomLevelInputChange,
    handleBrowserDefaultScaleChange: settingsActions.handleBrowserDefaultScaleChange,
    handleBrowserEnabledChange: settingsActions.handleBrowserEnabledChange,
    handleBrowserViewChange: settingsActions.handleBrowserViewChange,
    handleChatDropdownPreferenceChange: settingsActions.handleChatDropdownPreferenceChange,
    handleChatDropdownSettingChange: settingsActions.handleChatDropdownSettingChange,
    handleChatUsageDisplayChange: settingsActions.handleChatUsageDisplayChange,
    groupChatsByProject: projectState.chatGroupingPreference === 'grouped',
    chatSidebarTabs: chatState.chatSidebarTabs,
    handleChatSidebarTabChange: (tab, visible) => {
      const next = { ...chatState.chatSidebarTabs, [tab]: visible }
      chatState.setChatSidebarTabs(next)
      writeChatSidebarTabs(next)
    },
    handleGroupChatsByProjectChange: (enabled) => {
      const preference = enabled ? 'grouped' : 'ungrouped'
      projectState.setChatGroupingPreference(preference)
      writeChatGroupingPreference(preference)
    },
    handleCodexRecommendedPluginsChange: settingsActions.handleCodexRecommendedPluginsChange,
    handleNativeChromeChange: settingsActions.handleNativeChromeChange,
    handleContinuePromptChange: settingsActions.handleContinuePromptChange,
    handleLinkedChatSummaryPromptChange: settingsActions.handleLinkedChatSummaryPromptChange,
    handleGitCommitMessageGenerationChange: settingsActions.handleGitCommitMessageGenerationChange,
    handleGitCommitModelChange: settingsActions.handleGitCommitModelChange,
    handleGitCommitPromptChange: settingsActions.handleGitCommitPromptChange,
    handleGitErrorResolutionPromptChange: settingsActions.handleGitErrorResolutionPromptChange,
    handleGitQuickActionsChange: settingsActions.handleGitQuickActionsChange,
    handleGitPullRequestsEnabledChange: settingsActions.handleGitPullRequestsEnabledChange,
    handleGitUntrackedFilesPromptChange: settingsActions.handleGitUntrackedFilesPromptChange,
    handleGitWorktreeChange: settingsActions.handleGitWorktreeChange,
    handleMaxChatsRenderedChange: settingsActions.handleMaxChatsRenderedChange,
    handleNewSessionContainerChange: sourceControls.handleNewSessionContainerChange,
    handlePerformancePreferenceChange: settingsActions.handlePerformancePreferenceChange,
    handleProviderAppEnabledChange: resourceActions.handleProviderAppEnabledChange,
    handleProviderSkillEnabledChange: resourceActions.handleProviderSkillEnabledChange,
    handleProviderSkillsEnabledChange: resourceActions.handleProviderSkillsEnabledChange,
    handleNetworkRetrySettingChange: settingsActions.handleNetworkRetrySettingChange,
    handleRecentChatCacheLimitChange: settingsActions.handleRecentChatCacheLimitChange,
    handleRecentlyOpenedFilesLimitChange: settingsActions.handleRecentlyOpenedFilesLimitChange,
    handleRecentsMessageLimitChange: settingsActions.handleRecentsMessageLimitChange,
    handleThemePreferenceChange: settingsActions.handleThemePreferenceChange,
    installedFontFamilies: preferences.installedFontFamilies,
    installedFontOptions: settings.installedFontOptions,
    installedFontsLoaded: preferences.installedFontsLoaded,
    isScopedSettingControlDisabled: settingsActions.isScopedSettingControlDisabled,
    newSessionContainer: sourceState.newSessionContainer,
    newSessionContainerValue: sourceControls.newSessionContainerValue,
    newSessionProvider: sourceState.newSessionProvider,
    newSessionProviderOptions: sourceControls.newSessionProviderOptions,
    newSessionProviderValueContent: sourceControls.newSessionProviderValueContent,
    newSessionSourceAvailabilityReady: sourceState.newSessionSourceAvailabilityReady,
    providerAccountUpdatingId: providerState.providerAccountUpdatingId,
    providerResourceUpdatingKey: providerState.providerResourceUpdatingKey,
    providerResourcesError: providerState.providerResourcesError,
    providerResourcesLoadState: providerState.providerResourcesLoadState,
    renderProjectSettingAction: settingsActions.renderProjectSettingAction,
    setBrowserDefaultScaleInputDraft: preferences.setBrowserDefaultScaleInputDraft,
    setEditingSshEnvironment: sourceState.setEditingSshEnvironment,
    setNewSessionProvider: sourceState.setNewSessionProvider,
    setProviderResourcesRefresh: providerState.setProviderResourcesRefresh,
    setSshEnvironmentDialogOpen: sourceState.setSshEnvironmentDialogOpen,
    setSshEnvironmentError: sourceState.setSshEnvironmentError,
    settingsPanelSettings: settings.settingsPanelSettings,
    settingsProviderApps: providerState.settingsProviderApps,
    settingsProviderSkills: providerState.settingsProviderSkills,
    settingsScopeKey: settings.settingsScopeKey,
    settingsTab: preferences.settingsTab,
    sshEnvironmentError: sourceState.sshEnvironmentError,
    windowControlsHidden: chrome.windowControlsHidden
  }
  return { settingsProjectLabel, settingsPanelProps }
}
