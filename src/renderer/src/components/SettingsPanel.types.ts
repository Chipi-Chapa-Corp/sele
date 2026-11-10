import type { Dispatch, SetStateAction } from 'react'
import type { AppContainerTarget, AppSshEnvironment } from '../../../shared/app'
import type {
  ProviderAccountConfiguration,
  ProviderApprovalMode,
  ProviderId,
  ProviderSandboxMode
} from '../../../shared/provider'
import {
  type SettingsProviderApp,
  type SettingsProviderSkill
} from '../../../shared/providerOwnership'
import {
  type AppearanceFontKey,
  type AppProjectSettingPath,
  type ChatBooleanSettingKey
} from '../appProjectSettings'
import { type ChatSidebarFilter, type ChatSidebarTabs } from '../chatSidebarFilter'
import {
  type AppAppearanceControlStylePreference,
  type AppAppearancePositionPreference,
  type AppAppearanceStylePreference,
  type AppBrowserView,
  type AppChatDropdownSettings,
  type AppChatUsageDisplay,
  type AppGitCommitMessageGenerationSettings,
  type AppGitCommitPromptSettings,
  type AppGitQuickActionsSettings,
  type AppGitWorktreeSettings,
  type AppSettings,
  type AppThemePreference
} from '../settings'
import { type DropdownOption } from './Dropdown'

export type SettingsTab =
  | 'localNetwork'
  | 'appearance'
  | 'chat'
  | 'chatSidebar'
  | 'providers'
  | 'browser'
  | 'performance'
  | 'git'

export type ProviderResourcesLoadState = 'idle' | 'loading' | 'ready'

export type SettingsPanelProps = {
  groupChatsByProject: boolean
  handleGroupChatsByProjectChange: (enabled: boolean) => void
  chatSidebarTabs: ChatSidebarTabs
  handleChatSidebarTabChange: (tab: ChatSidebarFilter, visible: boolean) => void
  appearanceFontSizeInputDraft: { key: string; value: string } | null
  appearanceZoomLevelInput: string
  browserDefaultScaleInput: string
  changesContainer: AppContainerTarget | null
  changesContainerKey: string
  containerOptions: DropdownOption<string>[]
  forceAccessOptions: DropdownOption<'manual' | ProviderSandboxMode>[]
  forceModelOptions: DropdownOption<string>[]
  forceReasoningOptions: DropdownOption<string>[]
  forceReviewOptions: DropdownOption<'manual' | ProviderApprovalMode>[]
  forceSpeedOptions: DropdownOption<string>[]
  getSettingsFieldClassName: (...classNames: (string | false | null | undefined)[]) => string
  gitCommitModelOptions: DropdownOption<string>[]
  gitCommitModelValue: string
  gitSettingsModelCatalogLoading: boolean
  gitSettingsModelsCurrent: boolean
  gitSettingsModelsReady: boolean
  handleAppearanceControlStyleChange: (controlStyle: AppAppearanceControlStylePreference) => void
  handleAppearanceFontFamilyChange: (key: AppearanceFontKey, family: string) => void
  handleAppearanceFontSizeInputBlur: () => void
  handleAppearanceFontSizeInputChange: (key: AppearanceFontKey, value: string) => void
  handleAppearancePositionChange: (position: AppAppearancePositionPreference) => void
  handleAppearanceStyleChange: (style: AppAppearanceStylePreference) => void
  handleAppearanceZoomLevelInputBlur: () => void
  handleAppearanceZoomLevelInputChange: (value: string) => void
  handleBrowserDefaultScaleChange: (value: string) => void
  handleBrowserEnabledChange: (enabled: boolean) => void
  handleBrowserViewChange: (view: AppBrowserView) => void
  handleChatDropdownPreferenceChange: (key: ChatBooleanSettingKey, value: boolean) => void
  handleChatDropdownSettingChange: <Key extends keyof AppChatDropdownSettings>(
    key: Key,
    value: AppChatDropdownSettings[Key]
  ) => void
  handleChatUsageDisplayChange: (displayUsage: AppChatUsageDisplay) => void
  handleCodexRecommendedPluginsChange: (showRecommendedPlugins: boolean) => void
  handleNativeChromeChange: (provider: 'claude' | 'codex', enabled: boolean) => void
  handleNetworkRetrySettingChange: (
    key: 'networkRetryCount' | 'networkRetryDelaySeconds',
    value: number
  ) => void
  handleContinuePromptChange: (continuePrompt: string) => void
  handleLinkedChatSummaryPromptChange: (linkedChatSummaryPrompt: string) => void
  handleProviderConnectionsChanged: (providerId: ProviderId, container: AppContainerTarget) => void
  handleDeleteProviderAccount: (accountId: string) => Promise<void>
  handleGitCommitMessageGenerationChange: (
    key: keyof AppGitCommitMessageGenerationSettings,
    value: string
  ) => void
  handleGitCommitModelChange: (nextModel: string) => void
  handleGitPullRequestsEnabledChange: (enabled: boolean) => void
  handleGitCommitPromptChange: (key: keyof AppGitCommitPromptSettings, value: string) => void
  handleGitErrorResolutionPromptChange: (
    key: 'errorResolutionPrompt' | 'permanentErrorResolutionPrompt',
    value: string
  ) => void
  handleGitQuickActionsChange: <Key extends keyof AppGitQuickActionsSettings>(
    key: Key,
    value: AppGitQuickActionsSettings[Key]
  ) => void
  handleGitUntrackedFilesPromptChange: (untrackedFilesPrompt: string) => void
  handleGitWorktreeChange: (key: keyof AppGitWorktreeSettings, value: string) => void
  handleMaxChatsRenderedChange: (value: number) => void
  handleNewSessionContainerChange: (value: string) => void
  handlePerformancePreferenceChange: (key: 'disableShadows', value: boolean) => void
  handleProviderAppEnabledChange: (
    resource: SettingsProviderApp,
    childSkills: SettingsProviderSkill[],
    enabled: boolean
  ) => Promise<void>
  handleProviderSkillEnabledChange: (
    resource: SettingsProviderSkill,
    enabled: boolean
  ) => Promise<void>
  handleProviderSkillsEnabledChange: (
    resources: SettingsProviderSkill[],
    enabled: boolean
  ) => Promise<void>
  handleRecentChatCacheLimitChange: (value: number) => void
  handleRecentlyOpenedFilesLimitChange: (value: number) => void
  handleRecentsMessageLimitChange: (value: number) => void
  handleThemePreferenceChange: (theme: AppThemePreference) => void
  handleUseProviderAccount: (accountId: string) => Promise<void>
  installedFontFamilies: string[]
  installedFontOptions: DropdownOption<string>[]
  installedFontsLoaded: boolean
  isScopedSettingControlDisabled: (path: AppProjectSettingPath, disabled?: boolean) => boolean
  newSessionContainer: AppContainerTarget
  newSessionContainerValue: string
  newSessionProvider: ProviderId
  newSessionProviderOptions: DropdownOption<ProviderId>[]
  newSessionProviderValueContent: 'Checking' | 'No providers found' | undefined
  newSessionSourceAvailabilityReady: boolean
  providerAccountUpdatingId: string | null
  providerAccountsError: string | null
  providerAccountsLoadState: 'idle' | 'loading' | 'ready'
  providerResourceUpdatingKey: string | null
  providerResourcesError: string | null
  providerResourcesLoadState: ProviderResourcesLoadState
  renderProjectSettingAction: (
    path: AppProjectSettingPath,
    label: string
  ) => React.ReactElement | null
  setAccountDialogOpen: Dispatch<SetStateAction<boolean>>
  setBrowserDefaultScaleInputDraft: Dispatch<SetStateAction<{ key: string; value: string } | null>>
  setEditingSshEnvironment: Dispatch<SetStateAction<AppSshEnvironment | null>>
  setNewSessionProvider: Dispatch<SetStateAction<ProviderId>>
  setProviderAccountsRefresh: Dispatch<SetStateAction<number>>
  setProviderResourcesRefresh: Dispatch<SetStateAction<number>>
  setSshEnvironmentDialogOpen: Dispatch<SetStateAction<boolean>>
  setSshEnvironmentError: Dispatch<SetStateAction<string | null>>
  settingsPanelSettings: AppSettings
  settingsProviderAccounts: ProviderAccountConfiguration | null
  settingsProviderApps: SettingsProviderApp[]
  settingsProviderSkills: SettingsProviderSkill[]
  settingsScopeKey: string
  settingsTab: SettingsTab
  sshEnvironmentError: string | null
  windowControlsHidden: boolean
}
