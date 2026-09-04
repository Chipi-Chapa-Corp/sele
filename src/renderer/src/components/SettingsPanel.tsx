import type { Dispatch, SetStateAction } from 'react'
import {
  Apple,
  AppWindow,
  Check,
  EyeOff,
  Monitor,
  Moon,
  PackagePlus,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
  X
} from 'lucide-react'
import type { AppContainerTarget, AppSshEnvironment } from '../../../shared/app'
import type {
  ProviderAccountConfiguration,
  ProviderApprovalMode,
  ProviderId,
  ProviderSandboxMode
} from '../../../shared/provider'
import { providerDefaultAccountId } from '../../../shared/provider'
import {
  areAnySettingsProviderSkillsEnabled,
  groupSettingsProviderResources,
  isSettingsProviderAppGroupEnabled,
  shouldShowSettingsProviderAppSkills,
  type SettingsProviderApp,
  type SettingsProviderSkill
} from '../../../shared/providerOwnership'
import {
  appAppearanceZoomPercentMax,
  appAppearanceZoomPercentMin,
  appBrowserDefaultScaleMax,
  appBrowserDefaultScaleMin,
  appFontInheritValue,
  appFontMonospaceValue,
  appFontScalePercentMax,
  appFontScalePercentMin,
  appFontSizeToScalePercent,
  appFontSystemValue,
  appMaxChatsRenderedMin,
  appRecentlyOpenedFilesLimitMax,
  appRecentlyOpenedFilesLimitMin,
  appRecentsMessageLimitMax,
  appRecentsMessageLimitMin,
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
import {
  chatDropdownSettingFields,
  chatPromptBoxSettingFields,
  chatProgressSettingFields,
  chatStoppedSteeredFailedProgressSettingFields,
  type AppearanceFontKey,
  type AppProjectSettingPath,
  type ChatBooleanSettingField,
  type ChatBooleanSettingKey
} from '../appProjectSettings'
import { getSettingsSkillDescription } from '../providerSettings'
import { BrowserImportSettings } from './BrowserImportSettings'
import { Button } from './Button'
import { Dropdown, type DropdownOption } from './Dropdown'
import { Input } from './Input'
import { SegmentedControl } from './SegmentedControl'
import { SettingsSkillPathAction } from './SettingsSkillPathAction'
import { Switch } from './Switch'

export type SettingsTab = 'appearance' | 'chat' | 'providers' | 'browser' | 'performance' | 'git'
export type ProviderResourcesLoadState = 'idle' | 'loading' | 'ready'

export type SettingsPanelProps = {
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
  handleChatForcedDropdownChange: <Key extends keyof AppChatDropdownSettings>(
    key: Key,
    value: AppChatDropdownSettings[Key]
  ) => void
  handleChatUsageDisplayChange: (displayUsage: AppChatUsageDisplay) => void
  handleCodexRecommendedPluginsChange: (showRecommendedPlugins: boolean) => void
  handleContinuePromptChange: (continuePrompt: string) => void
  handleDeleteProviderAccount: (accountId: string) => Promise<void>
  handleGitCommitMessageGenerationChange: (
    key: keyof AppGitCommitMessageGenerationSettings,
    value: string
  ) => void
  handleGitCommitModelChange: (nextModel: string) => void
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

const themeOptions = [
  {
    value: 'light',
    label: 'Light',
    icon: <Sun aria-hidden="true" />
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: <Moon aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppThemePreference
  label: string
  icon: React.ReactNode
}[]

const browserViewOptions = [
  { value: 'chat', label: 'Per chat' },
  { value: 'project', label: 'Per project' },
  { value: 'global', label: 'Global' }
] satisfies readonly DropdownOption<AppBrowserView>[]

const appearancePositionOptions = [
  {
    value: 'left',
    label: 'Left',
    icon: <PanelLeft aria-hidden="true" />
  },
  {
    value: 'right',
    label: 'Right',
    icon: <PanelRight aria-hidden="true" />
  },
  {
    value: 'hidden',
    label: 'Hidden',
    icon: <EyeOff aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearancePositionPreference
  label: string
  icon: React.ReactNode
}[]

const appearanceStyleOptions = [
  {
    value: 'sele',
    label: 'Sele',
    icon: <AppWindow aria-hidden="true" />
  },
  {
    value: 'macos',
    label: 'macOS',
    icon: <Apple aria-hidden="true" />
  },
  {
    value: 'system',
    label: 'System',
    icon: <Monitor aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearanceStylePreference
  label: string
  icon: React.ReactNode
}[]

const appearanceControlStyleOptions = [
  {
    value: 'bordered',
    label: 'Bordered',
    icon: <AppWindow aria-hidden="true" />
  },
  {
    value: 'transparent',
    label: 'Transparent',
    icon: <Sparkles aria-hidden="true" />
  }
] satisfies readonly {
  value: AppAppearanceControlStylePreference
  label: string
  icon: React.ReactNode
}[]

const chatUsageDisplayOptions = [
  {
    value: 'chatContext',
    label: 'Chat context'
  },
  {
    value: 'global',
    label: 'Global'
  }
] satisfies readonly {
  value: AppChatUsageDisplay
  label: string
}[]

const gitCommitPromptFieldOptions = [
  {
    key: 'instructions',
    label: 'Instructions',
    rows: 6
  },
  {
    key: 'workflow',
    label: 'Workflow',
    rows: 9
  },
  {
    key: 'commitStep',
    label: 'Commit step',
    rows: 2
  },
  {
    key: 'extraInstructionsPrefix',
    label: 'Extra instructions prefix',
    rows: 1
  }
] satisfies readonly {
  key: keyof AppGitCommitPromptSettings
  label: string
  rows: number
}[]

export const renderSettingsPanel = (props: SettingsPanelProps): React.ReactNode => {
  const {
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
  } = props

  const renderChatBooleanSettingField = (field: ChatBooleanSettingField): React.ReactElement => {
    const path = { section: 'chat', key: field.key } satisfies AppProjectSettingPath

    return (
      <div className={getSettingsFieldClassName()} key={field.key}>
        <div className="settings-dialog__field-header">
          <h3 id={field.id}>{field.label}</h3>
          {field.description && <p>{field.description}</p>}
        </div>
        {renderProjectSettingAction(path, field.label)}
        <Switch
          className="settings-switch"
          aria-labelledby={field.id}
          checked={settingsPanelSettings.chat[field.key]}
          disabled={isScopedSettingControlDisabled(path)}
          onChange={(event) =>
            handleChatDropdownPreferenceChange(field.key, event.currentTarget.checked)
          }
        />
      </div>
    )
  }
  const chatDisplayUsagePath = {
    section: 'chat',
    key: 'displayUsage'
  } satisfies AppProjectSettingPath
  const chatForceAccessPath = {
    section: 'chat',
    key: 'forceAccess'
  } satisfies AppProjectSettingPath
  const chatForceReviewPath = {
    section: 'chat',
    key: 'forceReview'
  } satisfies AppProjectSettingPath
  const chatForceModelPath = {
    section: 'chat',
    key: 'forceModel'
  } satisfies AppProjectSettingPath
  const chatForceReasoningPath = {
    section: 'chat',
    key: 'forceReasoning'
  } satisfies AppProjectSettingPath
  const chatForceSpeedPath = {
    section: 'chat',
    key: 'forceSpeed'
  } satisfies AppProjectSettingPath
  const chatContinuePromptPath = {
    section: 'chat',
    key: 'continuePrompt'
  } satisfies AppProjectSettingPath
  const browserEnabledPath = {
    section: 'browser',
    key: 'enabled'
  } satisfies AppProjectSettingPath
  const browserDefaultScalePath = {
    section: 'browser',
    key: 'defaultScale'
  } satisfies AppProjectSettingPath
  const browserViewPath = {
    section: 'browser',
    key: 'view'
  } satisfies AppProjectSettingPath
  const performanceDisableShadowsPath = {
    section: 'performance',
    key: 'disableShadows'
  } satisfies AppProjectSettingPath
  const performanceMaxChatsRenderedPath = {
    section: 'performance',
    key: 'maxChatsRendered'
  } satisfies AppProjectSettingPath
  const performanceRecentsMessageLimitPath = {
    section: 'performance',
    key: 'recentsMessageLimit'
  } satisfies AppProjectSettingPath
  const performanceRecentlyOpenedFilesLimitPath = {
    section: 'performance',
    key: 'recentlyOpenedFilesLimit'
  } satisfies AppProjectSettingPath
  const chatRecentCacheLimitPath = {
    section: 'chat',
    key: 'recentChatCacheLimit'
  } satisfies AppProjectSettingPath
  const gitCommitModelsPath = {
    section: 'git',
    key: 'commitModels'
  } satisfies AppProjectSettingPath
  const gitUntrackedFilesPromptPath = {
    section: 'git',
    key: 'untrackedFilesPrompt'
  } satisfies AppProjectSettingPath
  const gitErrorResolutionPromptPath = {
    section: 'git',
    key: 'errorResolutionPrompt'
  } satisfies AppProjectSettingPath
  const gitPermanentErrorResolutionPromptPath = {
    section: 'git',
    key: 'permanentErrorResolutionPrompt'
  } satisfies AppProjectSettingPath
  const gitShowManualCommitPath = {
    section: 'gitQuickActions',
    key: 'showManualCommit'
  } satisfies AppProjectSettingPath
  const gitShowAiInstructionsInputPath = {
    section: 'gitQuickActions',
    key: 'showAiInstructionsInput'
  } satisfies AppProjectSettingPath
  const gitCommitGenerationPromptPath = {
    section: 'gitCommitMessageGeneration',
    key: 'prompt'
  } satisfies AppProjectSettingPath
  const gitCommitLargeChangePromptPath = {
    section: 'gitCommitMessageGeneration',
    key: 'largeChangePrompt'
  } satisfies AppProjectSettingPath
  const gitCommitGenerationPrefixPath = {
    section: 'gitCommitMessageGeneration',
    key: 'aiInstructionsPrefix'
  } satisfies AppProjectSettingPath
  const gitWorktreeBranchPromptPath = {
    section: 'gitWorktree',
    key: 'branchNamePrompt'
  } satisfies AppProjectSettingPath
  const appearanceThemePath = {
    section: 'appearance',
    key: 'theme'
  } satisfies AppProjectSettingPath
  const appearanceZoomPath = {
    section: 'appearance',
    key: 'zoomLevel'
  } satisfies AppProjectSettingPath
  const appearancePositionPath = {
    section: 'appearance',
    key: 'position'
  } satisfies AppProjectSettingPath
  const appearanceStylePath = {
    section: 'appearance',
    key: 'style'
  } satisfies AppProjectSettingPath
  const appearanceControlStylePath = {
    section: 'appearance',
    key: 'controlStyle'
  } satisfies AppProjectSettingPath
  const appearanceFontFields = [
    {
      key: 'applicationFont',
      label: 'Application font',
      specialOptions: [{ value: appFontSystemValue, label: 'System Default' }]
    },
    {
      key: 'chatFont',
      label: 'Chat font',
      specialOptions: [
        { value: appFontInheritValue, label: 'Inherit Application' },
        { value: appFontSystemValue, label: 'System Default' }
      ]
    },
    {
      key: 'codeFont',
      label: 'Code font',
      specialOptions: [{ value: appFontMonospaceValue, label: 'System Monospace' }]
    }
  ] satisfies readonly {
    key: AppearanceFontKey
    label: string
    specialOptions: readonly DropdownOption<string>[]
  }[]

  if (settingsTab === 'providers') {
    const providerResourcesLoading = providerResourcesLoadState !== 'ready'
    const providerAccountsLoading = providerAccountsLoadState !== 'ready'
    const { appGroups, unparentedSkills } = groupSettingsProviderResources(
      settingsProviderSkills,
      settingsProviderApps
    )
    const unparentedSkillsEnabled = areAnySettingsProviderSkillsEnabled(unparentedSkills)

    return (
      <section
        className="settings-dialog__panel"
        id="settings-panel-providers"
        role="tabpanel"
        aria-label="Provider settings"
      >
        <div
          className="settings-dialog__provider-configuration"
          role="group"
          aria-label="Provider configuration"
        >
          <span>Configure</span>
          <Dropdown
            aria-label="Provider"
            disabled={
              Boolean(providerResourceUpdatingKey) ||
              Boolean(providerAccountUpdatingId) ||
              newSessionProviderOptions.length === 0
            }
            emptyContent="No providers found"
            options={newSessionProviderOptions}
            size="small"
            value={newSessionProvider}
            valueContent={newSessionProviderValueContent}
            onChange={setNewSessionProvider}
          />
          <span>in</span>
          <Dropdown
            aria-label="Provider environment"
            disabled={Boolean(providerResourceUpdatingKey) || Boolean(providerAccountUpdatingId)}
            menuActions={[
              ...(sshEnvironmentError
                ? [
                    {
                      id: 'provider-environment-error',
                      label: sshEnvironmentError,
                      title: sshEnvironmentError,
                      disabled: true,
                      icon: <X aria-hidden="true" />,
                      callback: () => {}
                    }
                  ]
                : []),
              {
                id: 'provider-add-environment',
                label: 'Add environment',
                title: 'Add environment',
                icon: <PackagePlus aria-hidden="true" />,
                callback: () => {
                  setEditingSshEnvironment(null)
                  setSshEnvironmentError(null)
                  setSshEnvironmentDialogOpen(true)
                }
              }
            ]}
            options={containerOptions}
            size="small"
            value={newSessionContainerValue}
            valueContent={!newSessionSourceAvailabilityReady ? 'Checking' : undefined}
            onChange={handleNewSessionContainerChange}
          />
        </div>
        <section className="settings-dialog__section" aria-labelledby="settings-providers-accounts">
          <h2 className="settings-dialog__section-heading" id="settings-providers-accounts">
            Accounts
          </h2>
          <div className="settings-dialog__section-cards">
            {providerAccountsLoading ? (
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3>Loading accounts…</h3>
                </div>
              </div>
            ) : providerAccountsError ? (
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>{providerAccountsError}</h3>
                </div>
                <Button
                  callback={() => setProviderAccountsRefresh((refresh) => refresh + 1)}
                  disabled={Boolean(providerAccountUpdatingId)}
                  icon={<RefreshCw aria-hidden="true" />}
                  label={<span>Retry</span>}
                  size="small"
                  theme="secondary"
                />
              </div>
            ) : !settingsProviderAccounts?.available ? (
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3>{settingsProviderAccounts?.unavailableMessage}</h3>
                </div>
              </div>
            ) : (
              <>
                {settingsProviderAccounts.accounts.length === 0 && (
                  <div className="settings-dialog__field">
                    <div className="settings-dialog__field-header">
                      <h3>No accounts configured</h3>
                    </div>
                  </div>
                )}
                {settingsProviderAccounts.accounts.map((account) => (
                  <div
                    className="settings-dialog__field settings-dialog__field--inline"
                    key={account.id}
                  >
                    <div className="settings-dialog__field-header">
                      <h3>{account.name}</h3>
                      {account.active && <p>In use</p>}
                    </div>
                    <div className="settings-dialog__account-actions">
                      <Button
                        aria-pressed={account.active}
                        callback={() => handleUseProviderAccount(account.id)}
                        disabled={account.active || Boolean(providerAccountUpdatingId)}
                        icon={account.active ? <Check aria-hidden="true" /> : undefined}
                        label={<span>Use</span>}
                        size="small"
                        theme="secondary"
                      />
                      {account.id !== providerDefaultAccountId && (
                        <Button
                          callback={() => handleDeleteProviderAccount(account.id)}
                          disabled={Boolean(providerAccountUpdatingId)}
                          icon={<Trash2 aria-hidden="true" />}
                          label={<span>Delete</span>}
                          size="small"
                          theme="secondary"
                        />
                      )}
                    </div>
                  </div>
                ))}
                <div className="settings-dialog__field settings-dialog__field--inline">
                  <div className="settings-dialog__field-header">
                    <h3>Create another account</h3>
                  </div>
                  <Button
                    callback={() => setAccountDialogOpen(true)}
                    disabled={Boolean(providerAccountUpdatingId)}
                    icon={<Plus aria-hidden="true" />}
                    label={<span>Create</span>}
                    size="small"
                    theme="secondary"
                  />
                </div>
              </>
            )}
          </div>
        </section>
        {newSessionProvider === 'codex' && (
          <section className="settings-dialog__section" aria-labelledby="settings-providers-ads">
            <h2 className="settings-dialog__section-heading" id="settings-providers-ads">
              Ads
            </h2>
            <div className="settings-dialog__section-cards">
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3 id="settings-provider-codex-recommended-plugins">
                    Show recommended plugins to agent
                  </h3>
                  <p>Include the Codex list of available recommended plugins in new agent turns.</p>
                </div>
                <Switch
                  className="settings-switch"
                  aria-labelledby="settings-provider-codex-recommended-plugins"
                  checked={settingsPanelSettings.providers.codex.showRecommendedPlugins}
                  onChange={(event) =>
                    handleCodexRecommendedPluginsChange(event.currentTarget.checked)
                  }
                />
              </div>
            </div>
          </section>
        )}
        {providerResourcesError && (
          <section className="settings-dialog__section" aria-labelledby="settings-providers-status">
            <h2 className="settings-dialog__section-heading" id="settings-providers-status">
              Status
            </h2>
            <div className="settings-dialog__section-cards">
              <div className="settings-dialog__field settings-dialog__field--inline">
                <div className="settings-dialog__field-header">
                  <h3>{providerResourcesError}</h3>
                </div>
                <Button
                  callback={() => setProviderResourcesRefresh((refresh) => refresh + 1)}
                  disabled={providerResourcesLoading || Boolean(providerResourceUpdatingKey)}
                  icon={<RefreshCw aria-hidden="true" />}
                  label={<span>Retry</span>}
                  size="small"
                  theme="secondary"
                />
              </div>
            </div>
          </section>
        )}
        {providerResourcesLoading ? (
          <section className="settings-dialog__section" aria-labelledby="settings-providers-apps">
            <h2 className="settings-dialog__section-heading" id="settings-providers-apps">
              Apps
            </h2>
            <div className="settings-dialog__section-cards">
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3>Loading apps…</h3>
                </div>
              </div>
            </div>
          </section>
        ) : appGroups.length === 0 ? (
          <section className="settings-dialog__section" aria-labelledby="settings-providers-apps">
            <h2 className="settings-dialog__section-heading" id="settings-providers-apps">
              Apps
            </h2>
            <div className="settings-dialog__section-cards">
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3>No connected apps found</h3>
                  <p>This environment did not report any installed apps.</p>
                </div>
              </div>
            </div>
          </section>
        ) : (
          appGroups.map((group, appIndex) => {
            const { resource } = group
            const toggleId = `settings-provider-app-${appIndex}`
            const updateKey = `app:${resource.providerId}:${resource.app.id}`
            const appEnabled = isSettingsProviderAppGroupEnabled(group)

            return (
              <section
                className="settings-dialog__section"
                aria-label={resource.app.name}
                key={updateKey}
              >
                {appIndex === 0 && (
                  <h2 className="settings-dialog__section-heading" id="settings-providers-apps">
                    Apps
                  </h2>
                )}
                <div className="settings-dialog__section-cards">
                  <div className="settings-dialog__field">
                    <div className="settings-dialog__field-header">
                      <h3 id={toggleId}>{resource.app.name}</h3>
                      <p>
                        {resource.app.description}
                        {resource.app.enabled && !resource.app.callable
                          ? ' Not currently callable.'
                          : ''}
                      </p>
                    </div>
                    <Switch
                      className="settings-switch"
                      aria-labelledby={toggleId}
                      checked={appEnabled}
                      disabled={Boolean(providerResourceUpdatingKey)}
                      onChange={(event) =>
                        void handleProviderAppEnabledChange(
                          resource,
                          group.skills,
                          event.currentTarget.checked
                        )
                      }
                    />
                  </div>
                  {shouldShowSettingsProviderAppSkills(group) &&
                    group.skills.map((childSkill, skillIndex) => {
                      const skillToggleId = `settings-provider-app-${appIndex}-skill-${skillIndex}`

                      return (
                        <div className="settings-dialog__field" key={childSkill.skill.path}>
                          <div className="settings-dialog__field-header">
                            <div className="settings-dialog__skill-title">
                              <h3 id={skillToggleId}>{childSkill.skill.name}</h3>
                              <SettingsSkillPathAction path={childSkill.skill.path} />
                            </div>
                            <p>{getSettingsSkillDescription(childSkill.skill)}</p>
                          </div>
                          <Switch
                            className="settings-switch"
                            aria-labelledby={skillToggleId}
                            checked={childSkill.skill.enabled}
                            disabled={Boolean(providerResourceUpdatingKey)}
                            onChange={(event) =>
                              void handleProviderSkillEnabledChange(
                                childSkill,
                                event.currentTarget.checked
                              )
                            }
                          />
                        </div>
                      )
                    })}
                </div>
              </section>
            )
          })
        )}
        <section className="settings-dialog__section" aria-labelledby="settings-providers-skills">
          <h2 className="settings-dialog__section-heading" id="settings-providers-skills">
            Skills
          </h2>
          <div className="settings-dialog__section-cards">
            <div className="settings-dialog__field">
              <div className="settings-dialog__field-header">
                <h3 id="settings-provider-unparented-skills">All standalone skills</h3>
                <p>Enable or disable skills that are not part of an app.</p>
              </div>
              <Switch
                className="settings-switch"
                aria-labelledby="settings-provider-unparented-skills"
                checked={unparentedSkillsEnabled}
                disabled={
                  providerResourcesLoading ||
                  unparentedSkills.length === 0 ||
                  Boolean(providerResourceUpdatingKey)
                }
                onChange={(event) =>
                  void handleProviderSkillsEnabledChange(
                    unparentedSkills,
                    event.currentTarget.checked
                  )
                }
              />
            </div>
            {providerResourcesLoading ? (
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3>Loading skills…</h3>
                </div>
              </div>
            ) : unparentedSkills.length === 0 ? (
              <div className="settings-dialog__field">
                <div className="settings-dialog__field-header">
                  <h3>No standalone skills found</h3>
                  <p>All reported skills belong to an app.</p>
                </div>
              </div>
            ) : (
              unparentedSkills.map((resource, index) => {
                const toggleId = `settings-provider-skill-${index}`

                return (
                  <div className="settings-dialog__field" key={resource.skill.path}>
                    <div className="settings-dialog__field-header">
                      <div className="settings-dialog__skill-title">
                        <h3 id={toggleId}>{resource.skill.name}</h3>
                        <SettingsSkillPathAction path={resource.skill.path} />
                      </div>
                      <p>{getSettingsSkillDescription(resource.skill)}</p>
                    </div>
                    <Switch
                      className="settings-switch"
                      aria-labelledby={toggleId}
                      checked={resource.skill.enabled}
                      disabled={Boolean(providerResourceUpdatingKey)}
                      onChange={(event) =>
                        void handleProviderSkillEnabledChange(resource, event.currentTarget.checked)
                      }
                    />
                  </div>
                )
              })
            )}
          </div>
        </section>
      </section>
    )
  }

  if (settingsTab === 'chat') {
    return (
      <section
        className="settings-dialog__panel"
        id="settings-panel-chat"
        role="tabpanel"
        aria-label="Chat settings"
      >
        <section className="settings-dialog__section" aria-labelledby="settings-chat-prompt-box">
          <h2 className="settings-dialog__section-heading" id="settings-chat-prompt-box">
            Prompt Box
          </h2>
          <div className="settings-dialog__section-cards">
            {chatPromptBoxSettingFields.map(renderChatBooleanSettingField)}
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-chat-limits">
          <h2 className="settings-dialog__section-heading" id="settings-chat-limits">
            Limits
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Display usage</h3>
              </div>
              {renderProjectSettingAction(chatDisplayUsagePath, 'Display usage')}
              <SegmentedControl
                aria-label="Display usage"
                disabled={isScopedSettingControlDisabled(chatDisplayUsagePath)}
                options={chatUsageDisplayOptions}
                value={settingsPanelSettings.chat.displayUsage}
                onChange={handleChatUsageDisplayChange}
              />
            </div>
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-chat-dropdowns">
          <h2 className="settings-dialog__section-heading" id="settings-chat-dropdowns">
            Dropdowns
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Force access</h3>
                <p>Hide the chat dropdown and always use this access mode.</p>
              </div>
              {renderProjectSettingAction(chatForceAccessPath, 'Force access')}
              <Dropdown
                id="settings-chat-force-access"
                aria-label="Force access"
                disabled={isScopedSettingControlDisabled(chatForceAccessPath)}
                menuAlign="end"
                options={forceAccessOptions}
                value={settingsPanelSettings.chat.forceAccess}
                onChange={(value) => handleChatForcedDropdownChange('forceAccess', value)}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Force review</h3>
                <p>Hide the chat dropdown and always use this review mode.</p>
              </div>
              {renderProjectSettingAction(chatForceReviewPath, 'Force review')}
              <Dropdown
                id="settings-chat-force-review"
                aria-label="Force review"
                disabled={isScopedSettingControlDisabled(chatForceReviewPath)}
                menuAlign="end"
                options={forceReviewOptions}
                value={settingsPanelSettings.chat.forceReview}
                onChange={(value) => handleChatForcedDropdownChange('forceReview', value)}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Force model</h3>
                <p>Hide the chat dropdown and always use this model.</p>
              </div>
              {renderProjectSettingAction(chatForceModelPath, 'Force model')}
              <Dropdown
                id="settings-chat-force-model"
                aria-label="Force model"
                disabled={isScopedSettingControlDisabled(
                  chatForceModelPath,
                  forceModelOptions.length <= 1
                )}
                menuAlign="end"
                options={forceModelOptions}
                value={settingsPanelSettings.chat.forceModel}
                onChange={(value) => handleChatForcedDropdownChange('forceModel', value)}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Force reasoning</h3>
                <p>Hide the chat dropdown and always use this reasoning effort.</p>
              </div>
              {renderProjectSettingAction(chatForceReasoningPath, 'Force reasoning')}
              <Dropdown
                id="settings-chat-force-reasoning"
                aria-label="Force reasoning"
                disabled={isScopedSettingControlDisabled(
                  chatForceReasoningPath,
                  forceReasoningOptions.length <= 1
                )}
                menuAlign="end"
                options={forceReasoningOptions}
                value={settingsPanelSettings.chat.forceReasoning}
                onChange={(value) => handleChatForcedDropdownChange('forceReasoning', value)}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Force speed</h3>
                <p>Hide the chat dropdown and always use this speed.</p>
              </div>
              {renderProjectSettingAction(chatForceSpeedPath, 'Force speed')}
              <Dropdown
                id="settings-chat-force-speed"
                aria-label="Force speed"
                disabled={isScopedSettingControlDisabled(
                  chatForceSpeedPath,
                  forceSpeedOptions.length <= 1
                )}
                menuAlign="end"
                options={forceSpeedOptions}
                value={settingsPanelSettings.chat.forceSpeed}
                onChange={(value) => handleChatForcedDropdownChange('forceSpeed', value)}
              />
            </div>
            {chatDropdownSettingFields.map(renderChatBooleanSettingField)}
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-chat-progress">
          <h2 className="settings-dialog__section-heading" id="settings-chat-progress">
            Progress
          </h2>
          <div className="settings-dialog__section-cards">
            {chatProgressSettingFields.map(renderChatBooleanSettingField)}
          </div>
        </section>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-chat-exceptional-progress"
        >
          <h2 className="settings-dialog__section-heading" id="settings-chat-exceptional-progress">
            Stopped, steered, and failed turns
          </h2>
          <div className="settings-dialog__section-cards">
            {chatStoppedSteeredFailedProgressSettingFields.map(renderChatBooleanSettingField)}
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-chat-stopped-turns">
          <h2 className="settings-dialog__section-heading" id="settings-chat-stopped-turns">
            Stopped Turns
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-chat-continue-prompt"
              >
                <h3>Continue prompt</h3>
                <p>Sent as a new message when Continue is selected on a stopped turn.</p>
              </label>
              {renderProjectSettingAction(chatContinuePromptPath, 'Continue prompt')}
              <textarea
                id="settings-chat-continue-prompt"
                className="settings-dialog__prompt-textarea"
                rows={3}
                disabled={isScopedSettingControlDisabled(chatContinuePromptPath)}
                value={settingsPanelSettings.chat.continuePrompt}
                onChange={(event) => handleContinuePromptChange(event.currentTarget.value)}
              />
            </div>
          </div>
        </section>
      </section>
    )
  }

  if (settingsTab === 'performance') {
    return (
      <section
        className="settings-dialog__panel"
        id="settings-panel-performance"
        role="tabpanel"
        aria-label="Performance settings"
      >
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-performance-rendering"
        >
          <h2 className="settings-dialog__section-heading" id="settings-performance-rendering">
            Rendering
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName()}>
              <div className="settings-dialog__field-header">
                <h3 id="settings-performance-disable-shadows">Disable shadows</h3>
                <p>Remove box shadows throughout the app.</p>
              </div>
              {renderProjectSettingAction(performanceDisableShadowsPath, 'Disable shadows')}
              <Switch
                className="settings-switch"
                aria-labelledby="settings-performance-disable-shadows"
                checked={settingsPanelSettings.performance.disableShadows}
                disabled={isScopedSettingControlDisabled(performanceDisableShadowsPath)}
                onChange={(event) =>
                  handlePerformancePreferenceChange('disableShadows', event.currentTarget.checked)
                }
              />
            </div>
            <div className={getSettingsFieldClassName()}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-performance-max-chats-rendered"
              >
                <h3>Max chats rendered</h3>
                <p>
                  Render this many chats at a time in each sidebar group. Pinned chats are always
                  rendered.
                </p>
              </label>
              {renderProjectSettingAction(performanceMaxChatsRenderedPath, 'Max chats rendered')}
              <Input
                className="settings-dialog__number-input"
                id="settings-performance-max-chats-rendered"
                type="number"
                min={appMaxChatsRenderedMin}
                step={1}
                disabled={isScopedSettingControlDisabled(performanceMaxChatsRenderedPath)}
                value={settingsPanelSettings.performance.maxChatsRendered}
                onChange={(event) =>
                  handleMaxChatsRenderedChange(event.currentTarget.valueAsNumber)
                }
              />
            </div>
            <div className={getSettingsFieldClassName()}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-performance-recents-message-limit"
              >
                <h3>Messages scanned for Recents</h3>
                <p>
                  Include links and files from this many latest user messages and final responses.
                </p>
              </label>
              {renderProjectSettingAction(
                performanceRecentsMessageLimitPath,
                'Messages scanned for Recents'
              )}
              <Input
                className="settings-dialog__number-input"
                id="settings-performance-recents-message-limit"
                type="number"
                min={appRecentsMessageLimitMin}
                max={appRecentsMessageLimitMax}
                step={1}
                disabled={isScopedSettingControlDisabled(performanceRecentsMessageLimitPath)}
                value={settingsPanelSettings.performance.recentsMessageLimit}
                onChange={(event) =>
                  handleRecentsMessageLimitChange(event.currentTarget.valueAsNumber)
                }
              />
            </div>
            <div className={getSettingsFieldClassName()}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-performance-recently-opened-files-limit"
              >
                <h3>Recently opened files</h3>
                <p>Show this many recently opened or viewed files in the Recents sidebar.</p>
              </label>
              {renderProjectSettingAction(
                performanceRecentlyOpenedFilesLimitPath,
                'Recently opened files'
              )}
              <Input
                className="settings-dialog__number-input"
                id="settings-performance-recently-opened-files-limit"
                type="number"
                min={appRecentlyOpenedFilesLimitMin}
                max={appRecentlyOpenedFilesLimitMax}
                step={1}
                disabled={isScopedSettingControlDisabled(performanceRecentlyOpenedFilesLimitPath)}
                value={settingsPanelSettings.performance.recentlyOpenedFilesLimit}
                onChange={(event) =>
                  handleRecentlyOpenedFilesLimitChange(event.currentTarget.valueAsNumber)
                }
              />
            </div>
          </div>
        </section>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-performance-chat-cache"
        >
          <h2 className="settings-dialog__section-heading" id="settings-performance-chat-cache">
            Chat Cache
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName()}>
              <label className="settings-dialog__field-header" htmlFor="settings-chat-cache-limit">
                <h3>Cache recent chats</h3>
                <p>
                  Keep this many recent chats that haven’t been marked done in memory. Use 0 to
                  disable.
                </p>
              </label>
              {renderProjectSettingAction(chatRecentCacheLimitPath, 'Cache recent chats')}
              <Input
                className="settings-dialog__number-input"
                id="settings-chat-cache-limit"
                type="number"
                min={0}
                max={50}
                step={1}
                disabled={isScopedSettingControlDisabled(chatRecentCacheLimitPath)}
                value={settingsPanelSettings.chat.recentChatCacheLimit}
                onChange={(event) =>
                  handleRecentChatCacheLimitChange(event.currentTarget.valueAsNumber)
                }
              />
            </div>
          </div>
        </section>
      </section>
    )
  }

  if (settingsTab === 'git') {
    return (
      <section
        className="settings-dialog__panel"
        id="settings-panel-git"
        role="tabpanel"
        aria-label="Git settings"
      >
        <section className="settings-dialog__section" aria-labelledby="settings-git-quick-actions">
          <h2 className="settings-dialog__section-heading" id="settings-git-quick-actions">
            Quick actions
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName()}>
              <div className="settings-dialog__field-header">
                <h3 id="settings-git-show-manual-commit">Show manual commit</h3>
                <p>Show commit name generation and the manual Commit button.</p>
              </div>
              {renderProjectSettingAction(gitShowManualCommitPath, 'Show manual commit')}
              <Switch
                className="settings-switch"
                aria-labelledby="settings-git-show-manual-commit"
                checked={settingsPanelSettings.git.quickActions.showManualCommit}
                disabled={isScopedSettingControlDisabled(gitShowManualCommitPath)}
                onChange={(event) =>
                  handleGitQuickActionsChange('showManualCommit', event.currentTarget.checked)
                }
              />
            </div>
            <div className={getSettingsFieldClassName()}>
              <div className="settings-dialog__field-header">
                <h3 id="settings-git-show-ai-instructions-input">Show AI instructions input</h3>
                <p>Show an input for optional instructions sent to AI commit actions.</p>
              </div>
              {renderProjectSettingAction(
                gitShowAiInstructionsInputPath,
                'Show AI instructions input'
              )}
              <Switch
                className="settings-switch"
                aria-labelledby="settings-git-show-ai-instructions-input"
                checked={settingsPanelSettings.git.quickActions.showAiInstructionsInput}
                disabled={isScopedSettingControlDisabled(gitShowAiInstructionsInputPath)}
                onChange={(event) =>
                  handleGitQuickActionsChange(
                    'showAiInstructionsInput',
                    event.currentTarget.checked
                  )
                }
              />
            </div>
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-git-model">
          <h2 className="settings-dialog__section-heading" id="settings-git-model">
            AI model
          </h2>
          <div className="settings-dialog__section-cards">
            <div className="settings-dialog__field settings-dialog__field--inline">
              <div
                className="settings-dialog__provider-configuration settings-dialog__provider-configuration--row"
                role="group"
                aria-label="Git model configuration"
              >
                <span>Configure</span>
                <Dropdown
                  aria-label="Git model provider"
                  disabled={newSessionProviderOptions.length === 0}
                  emptyContent="No providers found"
                  options={newSessionProviderOptions}
                  size="small"
                  value={newSessionProvider}
                  valueContent={newSessionProviderValueContent}
                  onChange={setNewSessionProvider}
                />
                <span>in</span>
                <Dropdown
                  aria-label="Git model environment"
                  menuActions={[
                    ...(sshEnvironmentError
                      ? [
                          {
                            id: 'git-model-environment-error',
                            label: sshEnvironmentError,
                            title: sshEnvironmentError,
                            disabled: true,
                            icon: <X aria-hidden="true" />,
                            callback: () => {}
                          }
                        ]
                      : []),
                    {
                      id: 'git-model-add-environment',
                      label: 'Add environment',
                      title: 'Add environment',
                      icon: <PackagePlus aria-hidden="true" />,
                      callback: () => {
                        setEditingSshEnvironment(null)
                        setSshEnvironmentError(null)
                        setSshEnvironmentDialogOpen(true)
                      }
                    }
                  ]}
                  options={containerOptions}
                  size="small"
                  value={newSessionContainerValue}
                  valueContent={!newSessionSourceAvailabilityReady ? 'Checking' : undefined}
                  onChange={handleNewSessionContainerChange}
                />
              </div>
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>Commit model</h3>
              </div>
              {renderProjectSettingAction(gitCommitModelsPath, 'Commit model')}
              <Dropdown
                id="settings-git-commit-model"
                aria-label="Commit model"
                disabled={isScopedSettingControlDisabled(
                  gitCommitModelsPath,
                  !gitSettingsModelsReady ||
                    !gitSettingsModelsCurrent ||
                    gitSettingsModelCatalogLoading
                )}
                menuAlign="end"
                options={gitCommitModelOptions}
                value={gitCommitModelValue}
                onChange={handleGitCommitModelChange}
              />
            </div>
          </div>
        </section>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-git-error-resolution"
        >
          <h2 className="settings-dialog__section-heading" id="settings-git-error-resolution">
            Git error resolution
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-git-error-resolution-prompt"
              >
                <h3>Resolve with AI prompt</h3>
                <p>
                  Available variables: {'{cwd}'}, {'{operation}'}, and {'{error}'}.
                </p>
              </label>
              {renderProjectSettingAction(gitErrorResolutionPromptPath, 'Resolve with AI prompt')}
              <textarea
                id="settings-git-error-resolution-prompt"
                className="settings-dialog__prompt-textarea"
                rows={7}
                spellCheck={false}
                disabled={isScopedSettingControlDisabled(gitErrorResolutionPromptPath)}
                value={settingsPanelSettings.git.errorResolutionPrompt}
                onChange={(event) =>
                  handleGitErrorResolutionPromptChange(
                    'errorResolutionPrompt',
                    event.currentTarget.value
                  )
                }
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-git-permanent-error-resolution-prompt"
              >
                <h3>Permanent AI fix prompt</h3>
                <p>Sent from the Resolve with AI dropdown.</p>
              </label>
              {renderProjectSettingAction(
                gitPermanentErrorResolutionPromptPath,
                'Permanent AI fix prompt'
              )}
              <textarea
                id="settings-git-permanent-error-resolution-prompt"
                className="settings-dialog__prompt-textarea"
                rows={7}
                spellCheck={false}
                disabled={isScopedSettingControlDisabled(gitPermanentErrorResolutionPromptPath)}
                value={settingsPanelSettings.git.permanentErrorResolutionPrompt}
                onChange={(event) =>
                  handleGitErrorResolutionPromptChange(
                    'permanentErrorResolutionPrompt',
                    event.currentTarget.value
                  )
                }
              />
            </div>
          </div>
        </section>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-git-untracked-files"
        >
          <h2 className="settings-dialog__section-heading" id="settings-git-untracked-files">
            Untracked files
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-git-untracked-files-prompt"
              >
                <h3>Solve with AI prompt</h3>
                <p>Sent when resolving a large set of untracked files from the Git tab.</p>
              </label>
              {renderProjectSettingAction(gitUntrackedFilesPromptPath, 'Solve with AI prompt')}
              <textarea
                id="settings-git-untracked-files-prompt"
                className="settings-dialog__prompt-textarea"
                rows={3}
                spellCheck={false}
                disabled={isScopedSettingControlDisabled(gitUntrackedFilesPromptPath)}
                value={settingsPanelSettings.git.untrackedFilesPrompt}
                onChange={(event) => handleGitUntrackedFilesPromptChange(event.currentTarget.value)}
              />
            </div>
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-git-ai-chat-commit">
          <h2 className="settings-dialog__section-heading" id="settings-git-ai-chat-commit">
            AI Chat Commit
          </h2>
          <div className="settings-dialog__section-cards">
            {gitCommitPromptFieldOptions.map((field) => {
              const fieldId = `settings-git-commit-prompt-${field.key}`
              const path = {
                section: 'gitCommitPrompt',
                key: field.key
              } satisfies AppProjectSettingPath

              return (
                <div
                  className={getSettingsFieldClassName('settings-dialog__field--stack')}
                  key={field.key}
                >
                  <label className="settings-dialog__field-header" htmlFor={fieldId}>
                    <h3>{field.label}</h3>
                  </label>
                  {renderProjectSettingAction(path, field.label)}
                  <textarea
                    id={fieldId}
                    className="settings-dialog__prompt-textarea"
                    rows={field.rows}
                    spellCheck={false}
                    disabled={isScopedSettingControlDisabled(path)}
                    value={settingsPanelSettings.git.commitPrompt[field.key]}
                    onChange={(event) =>
                      handleGitCommitPromptChange(field.key, event.currentTarget.value)
                    }
                  />
                </div>
              )
            })}
          </div>
        </section>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-git-commit-name-generation"
        >
          <h2 className="settings-dialog__section-heading" id="settings-git-commit-name-generation">
            Commit name generation
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-git-commit-generation-prompt"
              >
                <h3>Generation prompt</h3>
              </label>
              {renderProjectSettingAction(gitCommitGenerationPromptPath, 'Generation prompt')}
              <textarea
                id="settings-git-commit-generation-prompt"
                className="settings-dialog__prompt-textarea"
                rows={4}
                spellCheck={false}
                disabled={isScopedSettingControlDisabled(gitCommitGenerationPromptPath)}
                value={settingsPanelSettings.git.commitMessageGeneration.prompt}
                onChange={(event) =>
                  handleGitCommitMessageGenerationChange('prompt', event.currentTarget.value)
                }
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-git-commit-large-change-prompt"
              >
                <h3>Large-change prompt</h3>
              </label>
              {renderProjectSettingAction(gitCommitLargeChangePromptPath, 'Large-change prompt')}
              <textarea
                id="settings-git-commit-large-change-prompt"
                className="settings-dialog__prompt-textarea"
                rows={6}
                spellCheck={false}
                disabled={isScopedSettingControlDisabled(gitCommitLargeChangePromptPath)}
                value={settingsPanelSettings.git.commitMessageGeneration.largeChangePrompt}
                onChange={(event) =>
                  handleGitCommitMessageGenerationChange(
                    'largeChangePrompt',
                    event.currentTarget.value
                  )
                }
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-git-ai-instructions-prefix"
              >
                <h3>AI instructions prefix</h3>
              </label>
              {renderProjectSettingAction(gitCommitGenerationPrefixPath, 'AI instructions prefix')}
              <Input
                id="settings-git-ai-instructions-prefix"
                disabled={isScopedSettingControlDisabled(gitCommitGenerationPrefixPath)}
                value={settingsPanelSettings.git.commitMessageGeneration.aiInstructionsPrefix}
                onChange={(event) =>
                  handleGitCommitMessageGenerationChange(
                    'aiInstructionsPrefix',
                    event.currentTarget.value
                  )
                }
              />
            </div>
          </div>
        </section>
        <section className="settings-dialog__section" aria-labelledby="settings-git-worktree">
          <h2 className="settings-dialog__section-heading" id="settings-git-worktree">
            Worktree
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--stack')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-git-worktree-branch-name-prompt"
              >
                <h3>Branch name prompt</h3>
              </label>
              {renderProjectSettingAction(gitWorktreeBranchPromptPath, 'Branch name prompt')}
              <textarea
                id="settings-git-worktree-branch-name-prompt"
                className="settings-dialog__prompt-textarea"
                rows={4}
                spellCheck={false}
                disabled={isScopedSettingControlDisabled(gitWorktreeBranchPromptPath)}
                value={settingsPanelSettings.git.worktree.branchNamePrompt}
                onChange={(event) =>
                  handleGitWorktreeChange('branchNamePrompt', event.currentTarget.value)
                }
              />
            </div>
          </div>
        </section>
      </section>
    )
  }

  if (settingsTab === 'browser') {
    return (
      <section
        className="settings-dialog__panel"
        id="settings-panel-browser"
        role="tabpanel"
        aria-label="Browser settings"
      >
        <section className="settings-dialog__section" aria-labelledby="settings-browser-behavior">
          <h2 className="settings-dialog__section-heading" id="settings-browser-behavior">
            Browser
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName()}>
              <div className="settings-dialog__field-header">
                <h3 id="settings-browser-enabled">Built-in browser</h3>
                <p>
                  Open web links in Browser tabs inside Sele. When off, links open in your default
                  browser.
                </p>
              </div>
              {renderProjectSettingAction(browserEnabledPath, 'Built-in browser')}
              <Switch
                className="settings-switch"
                aria-labelledby="settings-browser-enabled"
                checked={settingsPanelSettings.browser.enabled}
                disabled={isScopedSettingControlDisabled(browserEnabledPath)}
                onChange={(event) => handleBrowserEnabledChange(event.currentTarget.checked)}
              />
            </div>
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <div className="settings-dialog__field-header">
                <h3>View</h3>
                <p>Choose which conversations share a set of Browser tabs.</p>
              </div>
              {renderProjectSettingAction(browserViewPath, 'Browser view')}
              <SegmentedControl<AppBrowserView>
                aria-label="Browser view"
                className="settings-dialog__appearance-toggle"
                disabled={isScopedSettingControlDisabled(browserViewPath)}
                options={browserViewOptions}
                value={settingsPanelSettings.browser.view}
                onChange={handleBrowserViewChange}
              />
            </div>
          </div>
        </section>
        <section
          className="settings-dialog__section"
          aria-labelledby="settings-browser-accessibility"
        >
          <h2 className="settings-dialog__section-heading" id="settings-browser-accessibility">
            Accessibility
          </h2>
          <div className="settings-dialog__section-cards">
            <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
              <label
                className="settings-dialog__field-header"
                htmlFor="settings-browser-default-scale"
              >
                <h3>Default Scale</h3>
                <p>Set the default zoom for Browser pages.</p>
              </label>
              {renderProjectSettingAction(browserDefaultScalePath, 'Default Scale')}
              <div className="settings-dialog__number-with-unit">
                <Input
                  aria-label="Default browser scale percentage"
                  className="settings-dialog__number-input"
                  id="settings-browser-default-scale"
                  type="number"
                  min={appBrowserDefaultScaleMin}
                  max={appBrowserDefaultScaleMax}
                  step={5}
                  disabled={isScopedSettingControlDisabled(browserDefaultScalePath)}
                  value={browserDefaultScaleInput}
                  onBlur={() => setBrowserDefaultScaleInputDraft(null)}
                  onChange={(event) => handleBrowserDefaultScaleChange(event.currentTarget.value)}
                />
                <span aria-hidden="true" className="settings-dialog__number-unit">
                  %
                </span>
              </div>
            </div>
          </div>
        </section>
        <BrowserImportSettings key={changesContainerKey} currentEnvironment={changesContainer} />
      </section>
    )
  }

  return (
    <section
      className="settings-dialog__panel"
      id="settings-panel-appearance"
      role="tabpanel"
      aria-label="Appearance settings"
    >
      <section className="settings-dialog__section" aria-labelledby="settings-appearance-window">
        <h2 className="settings-dialog__section-heading" id="settings-appearance-window">
          Window
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Theme</h3>
            </div>
            {renderProjectSettingAction(appearanceThemePath, 'Theme')}
            <SegmentedControl
              aria-label="Theme"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(appearanceThemePath)}
              options={themeOptions}
              value={settingsPanelSettings.appearance.theme}
              onChange={handleThemePreferenceChange}
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <label
              className="settings-dialog__field-header"
              htmlFor="settings-appearance-zoom-level"
            >
              <h3>Zoom</h3>
            </label>
            {renderProjectSettingAction(appearanceZoomPath, 'Zoom')}
            <div className="settings-dialog__number-with-unit">
              <Input
                aria-label="Application zoom percentage"
                className="settings-dialog__number-input"
                id="settings-appearance-zoom-level"
                type="number"
                min={appAppearanceZoomPercentMin}
                max={appAppearanceZoomPercentMax}
                step={1}
                disabled={isScopedSettingControlDisabled(appearanceZoomPath)}
                value={appearanceZoomLevelInput}
                onBlur={handleAppearanceZoomLevelInputBlur}
                onChange={(event) =>
                  handleAppearanceZoomLevelInputChange(event.currentTarget.value)
                }
              />
              <span aria-hidden="true" className="settings-dialog__number-unit">
                %
              </span>
            </div>
          </div>
        </div>
      </section>
      <section
        className="settings-dialog__section"
        aria-labelledby="settings-appearance-window-controls"
      >
        <h2 className="settings-dialog__section-heading" id="settings-appearance-window-controls">
          Window Controls
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Position</h3>
            </div>
            {renderProjectSettingAction(appearancePositionPath, 'Position')}
            <SegmentedControl
              aria-label="Position"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(appearancePositionPath)}
              options={appearancePositionOptions}
              value={settingsPanelSettings.appearance.position}
              onChange={handleAppearancePositionChange}
            />
          </div>
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Style</h3>
            </div>
            {renderProjectSettingAction(appearanceStylePath, 'Window control style')}
            <SegmentedControl
              aria-label="Window control style"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(appearanceStylePath, windowControlsHidden)}
              options={appearanceStyleOptions}
              value={settingsPanelSettings.appearance.style}
              onChange={handleAppearanceStyleChange}
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-appearance-buttons">
        <h2 className="settings-dialog__section-heading" id="settings-appearance-buttons">
          Buttons
        </h2>
        <div className="settings-dialog__section-cards">
          <div className={getSettingsFieldClassName('settings-dialog__field--inline')}>
            <div className="settings-dialog__field-header">
              <h3>Style</h3>
            </div>
            {renderProjectSettingAction(appearanceControlStylePath, 'Button style')}
            <SegmentedControl
              aria-label="Button style"
              className="settings-dialog__appearance-toggle"
              disabled={isScopedSettingControlDisabled(appearanceControlStylePath)}
              options={appearanceControlStyleOptions}
              value={settingsPanelSettings.appearance.controlStyle}
              onChange={handleAppearanceControlStyleChange}
            />
          </div>
        </div>
      </section>
      <section className="settings-dialog__section" aria-labelledby="settings-appearance-fonts">
        <h2 className="settings-dialog__section-heading" id="settings-appearance-fonts">
          Fonts
        </h2>
        <div className="settings-dialog__section-cards">
          {appearanceFontFields.map((field) => {
            const path = {
              section: 'appearance',
              key: field.key
            } satisfies AppProjectSettingPath
            const font = settingsPanelSettings.appearance[field.key]
            const specialValues = new Set(field.specialOptions.map((option) => option.value))
            const selectedFontIsMissing =
              !specialValues.has(font.family) &&
              !installedFontFamilies.some((family) => family === font.family)
            const options = [
              ...field.specialOptions,
              ...(selectedFontIsMissing
                ? [{ value: font.family, label: `${font.family} (Unavailable)` }]
                : []),
              ...installedFontOptions
            ]
            const draftKey = `${settingsScopeKey}:${field.key}`
            const sizeInput =
              appearanceFontSizeInputDraft?.key === draftKey
                ? appearanceFontSizeInputDraft.value
                : String(appFontSizeToScalePercent(font.size))
            const disabled = isScopedSettingControlDisabled(path)

            return (
              <div
                className={getSettingsFieldClassName('settings-dialog__field--inline')}
                key={field.key}
              >
                <div className="settings-dialog__field-header">
                  <h3>{field.label}</h3>
                  {!installedFontsLoaded && <p>Loading installed fonts…</p>}
                </div>
                {renderProjectSettingAction(path, field.label)}
                <div className="settings-dialog__font-controls">
                  <Dropdown
                    aria-label={field.label}
                    className="settings-dialog__font-dropdown"
                    disabled={disabled}
                    options={options}
                    value={font.family}
                    onChange={(family) => handleAppearanceFontFamilyChange(field.key, family)}
                  />
                  <label className="settings-dialog__font-size">
                    <span className="sr-only">{field.label} scale</span>
                    <Input
                      aria-label={`${field.label} scale percentage`}
                      type="number"
                      min={appFontScalePercentMin}
                      max={appFontScalePercentMax}
                      step={2.5}
                      disabled={disabled}
                      value={sizeInput}
                      onBlur={handleAppearanceFontSizeInputBlur}
                      onChange={(event) =>
                        handleAppearanceFontSizeInputChange(field.key, event.currentTarget.value)
                      }
                    />
                    <span aria-hidden="true">%</span>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </section>
  )
}
