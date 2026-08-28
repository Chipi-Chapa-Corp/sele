/* eslint-disable react-hooks/exhaustive-deps -- controller refs and state setters are stable inputs */
import { useCallback } from 'react'
import { SquarePen, Undo2 } from 'lucide-react'
import type { AppProject, AppProjectIcon } from '../../../shared/app'
import type {
  ProviderApprovalMode,
  ProviderId,
  ProviderModelId,
  ProviderReasoningEffort,
  ProviderSandboxMode
} from '../../../shared/provider'
import { Button } from '../components/Button'
import type { AppAction } from '../actions'
import { appApi } from '../appApi'
import { providerApi } from '../providerApi'
import {
  type AppAppearancePositionPreference,
  type AppAppearanceControlStylePreference,
  type AppAppearanceStylePreference,
  type AppBrowserView,
  type AppFontSetting,
  type AppGitCommitMessageGenerationSettings,
  type AppGitCommitPromptSettings,
  type AppGitQuickActionsSettings,
  type AppGitWorktreeSettings,
  type AppChatDropdownSettings,
  type AppChatUsageDisplay,
  type AppProjectSettingsOverrides,
  type AppSettings,
  type AppThemePreference,
  appAppearanceZoomPercentMax,
  appAppearanceZoomPercentMin,
  appAppearanceZoomPercentToLevel,
  appBrowserDefaultScaleMax,
  appBrowserDefaultScaleMin,
  appFontScalePercentMax,
  appFontScalePercentMin,
  appFontScalePercentToSize,
  normalizeAppBrowserDefaultScale,
  normalizeAppMaxChatsRendered,
  normalizeAppRecentlyOpenedFilesLimit,
  normalizeAppRecentsMessageLimit
} from '../settings'
import { setAppGitCommitModel } from '../gitCommitModels'
import { normalizeContainerTarget } from '../containerSelection'
import {
  getProviderUpdatePreference,
  providerLabels,
  shouldSuggestProviderUpdate,
  type ProviderUpdatePreference
} from '../providerSettings'
import {
  clearAppProjectSettingOverrideValue,
  getAppProjectSettingValue,
  getProjectSettingPathId,
  isAppProjectSettingOverridden,
  setAppProjectSettingOverrideValue,
  setAppProjectSettingsForCwd,
  type AppearanceFontKey,
  type AppProjectSettingPath,
  type ChatBooleanSettingKey
} from '../appProjectSettings'
import { gitCurrentChatModelValue } from './controllerTypes'
import {
  getDefaultReasoningEffort,
  modelHasReasoningEffortOptions
} from './appearanceControllerUtils'
import {
  getChatCwdGroupKey,
  getErrorMessage,
  mergeProjects,
  modelSupportsReasoningEffort,
  trimRecentChatCache
} from './chatControllerUtils'
import type { SettingsControllerDependencies } from './featureControllerDependencies'

// Return shape is inferred from the controller declarations below.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSettingsController(dependencies: SettingsControllerDependencies) {
  const {
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
  } = dependencies

  const updateAppSettings = (update: (settings: AppSettings) => AppSettings): void => {
    setAppSettings((currentSettings) => update(currentSettings))
  }
  const updateProjectSettings = (
    update: (overrides: AppProjectSettingsOverrides) => AppProjectSettingsOverrides
  ): void => {
    if (!settingsProjectCwd) return

    setProjectSettingsByCwd((currentSettings) => {
      const currentOverrides = currentSettings[settingsProjectCwd] ?? {}
      const nextOverrides = update(currentOverrides)
      return setAppProjectSettingsForCwd(currentSettings, settingsProjectCwd, nextOverrides)
    })
  }
  const updateScopedSetting = (
    path: AppProjectSettingPath,
    value: unknown,
    updateGlobal: (settings: AppSettings) => AppSettings
  ): void => {
    if (settingsViewIsProject && settingsProjectCwd) {
      updateProjectSettings((currentOverrides) =>
        setAppProjectSettingOverrideValue(currentOverrides, path, value)
      )
      return
    }

    updateAppSettings(updateGlobal)
  }
  const handleEditProjectSetting = (path: AppProjectSettingPath): void => {
    if (!settingsProjectCwd) return

    updateProjectSettings((currentOverrides) =>
      setAppProjectSettingOverrideValue(
        currentOverrides,
        path,
        getAppProjectSettingValue(effectiveAppSettings, path)
      )
    )
  }
  const handleResetProjectSetting = (path: AppProjectSettingPath): void => {
    if (!settingsProjectCwd) return

    setAppearanceZoomLevelInputDraft(null)
    setBrowserDefaultScaleInputDraft(null)
    setAppearanceFontSizeInputDraft(null)
    updateProjectSettings((currentOverrides) =>
      clearAppProjectSettingOverrideValue(currentOverrides, path)
    )
  }
  const isProjectSettingOverrideEnabled = (path: AppProjectSettingPath): boolean =>
    settingsViewIsProject && isAppProjectSettingOverridden(settingsProjectOverrides, path)
  const isScopedSettingControlDisabled = (path: AppProjectSettingPath, disabled = false): boolean =>
    disabled || (settingsViewIsProject && !isProjectSettingOverrideEnabled(path))
  const getSettingsFieldClassName = (
    ...classNames: (string | false | null | undefined)[]
  ): string =>
    [
      'settings-dialog__field',
      settingsViewIsProject ? 'settings-dialog__field--with-project-action' : null,
      ...classNames
    ]
      .filter(Boolean)
      .join(' ')
  const renderProjectSettingAction = (
    path: AppProjectSettingPath,
    label: string
  ): React.ReactElement | null => {
    if (!settingsViewIsProject) return null

    const overridden = isProjectSettingOverrideEnabled(path)
    const actionLabel = overridden ? `Reset ${label}` : `Edit ${label}`

    return (
      <span className="settings-dialog__project-action">
        <Button
          id={getProjectSettingPathId(path)}
          aria-label={actionLabel}
          title={actionLabel}
          callback={() =>
            overridden ? handleResetProjectSetting(path) : handleEditProjectSetting(path)
          }
          icon={overridden ? <Undo2 aria-hidden="true" /> : <SquarePen aria-hidden="true" />}
          size="small"
          theme="transparent"
        />
      </span>
    )
  }
  const handleActionsChange = (actions: AppAction[]): void => {
    updateAppSettings((currentSettings) => {
      const lastActionId = actions.some((action) => action.id === currentSettings.lastActionId)
        ? currentSettings.lastActionId
        : null

      return {
        ...currentSettings,
        actions,
        lastActionId
      }
    })
  }
  const handleLastActionChange = (actionId: string | null): void => {
    updateAppSettings((currentSettings) => ({
      ...currentSettings,
      lastActionId: actionId
    }))
  }
  const handleThemePreferenceChange = (theme: AppThemePreference): void => {
    updateScopedSetting({ section: 'appearance', key: 'theme' }, theme, (currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        theme
      }
    }))
  }
  const handleBrowserEnabledChange = (enabled: boolean): void => {
    updateScopedSetting({ section: 'browser', key: 'enabled' }, enabled, (currentSettings) => ({
      ...currentSettings,
      browser: {
        ...currentSettings.browser,
        enabled
      }
    }))
  }
  const handleBrowserDefaultScaleChange = (value: string): void => {
    setBrowserDefaultScaleInputDraft({ key: settingsScopeKey, value })

    const parsedValue = Number(value.trim())
    if (!value.trim() || !Number.isFinite(parsedValue)) return
    if (parsedValue < appBrowserDefaultScaleMin || parsedValue > appBrowserDefaultScaleMax) return

    const defaultScale = normalizeAppBrowserDefaultScale(parsedValue)
    updateScopedSetting(
      { section: 'browser', key: 'defaultScale' },
      defaultScale,
      (currentSettings) => ({
        ...currentSettings,
        browser: {
          ...currentSettings.browser,
          defaultScale
        }
      })
    )
  }
  const handleBrowserViewChange = (view: AppBrowserView): void => {
    updateScopedSetting({ section: 'browser', key: 'view' }, view, (currentSettings) => ({
      ...currentSettings,
      browser: {
        ...currentSettings.browser,
        view
      }
    }))
  }
  const handleAppearanceZoomLevelInputChange = (value: string): void => {
    setAppearanceZoomLevelInputDraft({ key: settingsScopeKey, value })

    const trimmedValue = value.trim()
    if (!trimmedValue || trimmedValue === '-' || trimmedValue === '+') return

    const zoomPercent = Number(trimmedValue)
    if (!Number.isFinite(zoomPercent)) return
    if (zoomPercent < appAppearanceZoomPercentMin || zoomPercent > appAppearanceZoomPercentMax)
      return

    updateAppearanceZoomLevel(appAppearanceZoomPercentToLevel(zoomPercent), false)
  }
  const handleAppearanceZoomLevelInputBlur = (): void => {
    setAppearanceZoomLevelInputDraft(null)
  }
  const handleAppearancePositionChange = (position: AppAppearancePositionPreference): void => {
    updateScopedSetting(
      { section: 'appearance', key: 'position' },
      position,
      (currentSettings) => ({
        ...currentSettings,
        appearance: {
          ...currentSettings.appearance,
          position
        }
      })
    )
  }
  const handleAppearanceStyleChange = (style: AppAppearanceStylePreference): void => {
    updateScopedSetting({ section: 'appearance', key: 'style' }, style, (currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        style
      }
    }))
  }
  const handleAppearanceControlStyleChange = (
    controlStyle: AppAppearanceControlStylePreference
  ): void => {
    updateScopedSetting(
      { section: 'appearance', key: 'controlStyle' },
      controlStyle,
      (currentSettings) => ({
        ...currentSettings,
        appearance: {
          ...currentSettings.appearance,
          controlStyle
        }
      })
    )
  }
  const updateAppearanceFont = (key: AppearanceFontKey, font: AppFontSetting): void => {
    updateScopedSetting({ section: 'appearance', key }, font, (currentSettings) => ({
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        [key]: font
      }
    }))
  }
  const handleAppearanceFontFamilyChange = (key: AppearanceFontKey, family: string): void => {
    updateAppearanceFont(key, {
      ...settingsPanelSettings.appearance[key],
      family
    })
  }
  const handleAppearanceFontSizeInputChange = (key: AppearanceFontKey, value: string): void => {
    const draftKey = `${settingsScopeKey}:${key}`
    setAppearanceFontSizeInputDraft({ key: draftKey, value })

    const trimmedValue = value.trim()
    if (!trimmedValue) return

    const scalePercent = Number(trimmedValue)
    if (!Number.isFinite(scalePercent)) return
    if (scalePercent < appFontScalePercentMin || scalePercent > appFontScalePercentMax) return

    const currentFont = settingsPanelSettings.appearance[key]
    updateAppearanceFont(key, {
      ...currentFont,
      size: appFontScalePercentToSize(scalePercent, currentFont.size)
    })
  }
  const handleAppearanceFontSizeInputBlur = (): void => {
    setAppearanceFontSizeInputDraft(null)
  }
  const handleChatUsageDisplayChange = (displayUsage: AppChatUsageDisplay): void => {
    updateScopedSetting(
      { section: 'chat', key: 'displayUsage' },
      displayUsage,
      (currentSettings) => ({
        ...currentSettings,
        chat: {
          ...currentSettings.chat,
          displayUsage
        }
      })
    )
  }
  const handleChatDropdownPreferenceChange = (key: ChatBooleanSettingKey, value: boolean): void => {
    updateScopedSetting({ section: 'chat', key }, value, (currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        [key]: value
      }
    }))
  }
  const handleChatForcedDropdownChange = <Key extends keyof AppChatDropdownSettings>(
    key: Key,
    value: AppChatDropdownSettings[Key]
  ): void => {
    updateScopedSetting({ section: 'chat', key }, value, (currentSettings) => ({
      ...currentSettings,
      chat: {
        ...currentSettings.chat,
        [key]: value
      }
    }))
  }
  const handlePerformancePreferenceChange = (key: 'disableShadows', value: boolean): void => {
    updateScopedSetting({ section: 'performance', key }, value, (currentSettings) => ({
      ...currentSettings,
      performance: {
        ...currentSettings.performance,
        [key]: value
      }
    }))
  }
  const handleMaxChatsRenderedChange = (value: number): void => {
    if (!Number.isFinite(value)) return

    const maxChatsRendered = normalizeAppMaxChatsRendered(value)
    updateScopedSetting(
      { section: 'performance', key: 'maxChatsRendered' },
      maxChatsRendered,
      (currentSettings) => ({
        ...currentSettings,
        performance: {
          ...currentSettings.performance,
          maxChatsRendered
        }
      })
    )
  }
  const handleRecentsMessageLimitChange = (value: number): void => {
    if (!Number.isFinite(value)) return

    const recentsMessageLimit = normalizeAppRecentsMessageLimit(value)
    updateScopedSetting(
      { section: 'performance', key: 'recentsMessageLimit' },
      recentsMessageLimit,
      (currentSettings) => ({
        ...currentSettings,
        performance: {
          ...currentSettings.performance,
          recentsMessageLimit
        }
      })
    )
  }
  const handleRecentlyOpenedFilesLimitChange = (value: number): void => {
    if (!Number.isFinite(value)) return

    const recentlyOpenedFilesLimit = normalizeAppRecentlyOpenedFilesLimit(value)
    updateScopedSetting(
      { section: 'performance', key: 'recentlyOpenedFilesLimit' },
      recentlyOpenedFilesLimit,
      (currentSettings) => ({
        ...currentSettings,
        performance: {
          ...currentSettings.performance,
          recentlyOpenedFilesLimit
        }
      })
    )
  }
  const handleRecentChatCacheLimitChange = (value: number): void => {
    if (!Number.isFinite(value)) return

    const recentChatCacheLimit = Math.min(Math.max(Math.floor(value), 0), 50)
    recentChatCacheLimitRef.current = recentChatCacheLimit
    if (recentChatCacheLimit === 0) {
      recentChatCacheRef.current.clear()
    } else {
      trimRecentChatCache(recentChatCacheRef.current, recentChatCacheLimit)
      if (selectedChat && chatDetail?.id === selectedChat.id) {
        cacheRecentChatDetail(selectedChat.providerId, chatDetail, selectedChat.updatedAt, true)
      }
    }

    updateScopedSetting(
      { section: 'chat', key: 'recentChatCacheLimit' },
      recentChatCacheLimit,
      (currentSettings) => ({
        ...currentSettings,
        chat: {
          ...currentSettings.chat,
          recentChatCacheLimit
        }
      })
    )
  }
  const handleContinuePromptChange = (continuePrompt: string): void => {
    updateScopedSetting(
      { section: 'chat', key: 'continuePrompt' },
      continuePrompt,
      (currentSettings) => ({
        ...currentSettings,
        chat: {
          ...currentSettings.chat,
          continuePrompt
        }
      })
    )
  }
  const handleGitCommitModelChange = (nextModel: string): void => {
    const commitModel = nextModel === gitCurrentChatModelValue ? null : nextModel
    const commitModels = setAppGitCommitModel(
      settingsPanelSettings.git.commitModels,
      newSessionProvider,
      newSessionContainerKey,
      commitModel
    )

    updateScopedSetting(
      { section: 'git', key: 'commitModels' },
      commitModels,
      (currentSettings) => ({
        ...currentSettings,
        git: {
          ...currentSettings.git,
          commitModels
        }
      })
    )
  }
  const handleGitUntrackedFilesPromptChange = (untrackedFilesPrompt: string): void => {
    updateScopedSetting(
      { section: 'git', key: 'untrackedFilesPrompt' },
      untrackedFilesPrompt,
      (currentSettings) => ({
        ...currentSettings,
        git: {
          ...currentSettings.git,
          untrackedFilesPrompt
        }
      })
    )
  }
  const handleGitErrorResolutionPromptChange = (
    key: 'errorResolutionPrompt' | 'permanentErrorResolutionPrompt',
    value: string
  ): void => {
    updateScopedSetting({ section: 'git', key }, value, (currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        [key]: value
      }
    }))
  }
  const handleGitQuickActionsChange = <Key extends keyof AppGitQuickActionsSettings>(
    key: Key,
    value: AppGitQuickActionsSettings[Key]
  ): void => {
    updateScopedSetting({ section: 'gitQuickActions', key }, value, (currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        quickActions: {
          ...currentSettings.git.quickActions,
          [key]: value
        }
      }
    }))
  }
  const handleGitCommitPromptChange = (
    key: keyof AppGitCommitPromptSettings,
    value: string
  ): void => {
    updateScopedSetting({ section: 'gitCommitPrompt', key }, value, (currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        commitPrompt: {
          ...currentSettings.git.commitPrompt,
          [key]: value
        }
      }
    }))
  }
  const handleGitCommitMessageGenerationChange = (
    key: keyof AppGitCommitMessageGenerationSettings,
    value: string
  ): void => {
    updateScopedSetting(
      { section: 'gitCommitMessageGeneration', key },
      value,
      (currentSettings) => ({
        ...currentSettings,
        git: {
          ...currentSettings.git,
          commitMessageGeneration: {
            ...currentSettings.git.commitMessageGeneration,
            [key]: value
          }
        }
      })
    )
  }
  const handleGitWorktreeChange = (key: keyof AppGitWorktreeSettings, value: string): void => {
    updateScopedSetting({ section: 'gitWorktree', key }, value, (currentSettings) => ({
      ...currentSettings,
      git: {
        ...currentSettings.git,
        worktree: {
          ...currentSettings.git.worktree,
          [key]: value
        }
      }
    }))
  }
  const rememberProject = useCallback(async (cwd: string | null | undefined): Promise<void> => {
    const normalizedCwd = cwd?.trim()
    if (!normalizedCwd) return

    try {
      const project = await appApi.addProject({ cwd: normalizedCwd })
      setProjects((currentProjects) => mergeProjects(currentProjects, [project]))
    } catch {
      // Keep the project selected even if local persistence fails.
    }
  }, [])
  const handleProjectSaved = (project: AppProject, image: AppProjectIcon | null): void => {
    setProjects((currentProjects) => mergeProjects(currentProjects, [project]))
    setNewSessionCwd(project.cwd)
    setProjectDialogOpen(false)

    if (image) {
      setProjectIconsByGroup((currentIcons) => ({
        ...currentIcons,
        [getChatCwdGroupKey(project.cwd)]: image
      }))
    }
  }
  const handleModelChange = (nextModelId: ProviderModelId): void => {
    modelManuallySelectedRef.current = true
    setModel(nextModelId)

    const nextModel = models.find((candidateModel) => candidateModel.id === nextModelId)
    if (!nextModel) return

    setReasoningEffort((currentReasoningEffort) => {
      if (!modelHasReasoningEffortOptions(nextModel)) {
        reasoningManuallySelectedRef.current = false
        return getDefaultReasoningEffort(nextModel)
      }
      if (
        reasoningManuallySelectedRef.current &&
        modelSupportsReasoningEffort(nextModel, currentReasoningEffort)
      ) {
        return currentReasoningEffort
      }

      reasoningManuallySelectedRef.current = false
      return getDefaultReasoningEffort(nextModel)
    })
  }
  const handleReasoningEffortChange = (nextReasoningEffort: ProviderReasoningEffort): void => {
    reasoningManuallySelectedRef.current = true
    setReasoningEffort(nextReasoningEffort)
  }
  const handleApprovalModeChange = (nextApprovalMode: ProviderApprovalMode): void => {
    if (sandboxMode === 'danger-full-access') return

    approvalModeManuallySelectedRef.current = true
    setApprovalMode(nextApprovalMode)
  }
  const handleSandboxModeChange = (nextSandboxMode: ProviderSandboxMode): void => {
    sandboxModeManuallySelectedRef.current = true

    if (nextSandboxMode === 'danger-full-access') {
      if (sandboxMode !== 'danger-full-access') {
        approvalModeBeforeFullAccessRef.current = approvalMode === 'never' ? null : approvalMode
      }
      setApprovalMode('never')
    } else if (
      sandboxMode === 'danger-full-access' &&
      approvalMode === 'never' &&
      approvalModeBeforeFullAccessRef.current
    ) {
      setApprovalMode(approvalModeBeforeFullAccessRef.current)
      approvalModeBeforeFullAccessRef.current = null
    }

    setSandboxMode(nextSandboxMode)
  }
  const updateProviderUpdatePreference = (
    providerId: ProviderId,
    update: (preference: ProviderUpdatePreference) => ProviderUpdatePreference
  ): void => {
    setProviderUpdatePreferences((currentPreferences) => ({
      ...currentPreferences,
      [providerId]: update(getProviderUpdatePreference(currentPreferences, providerId))
    }))
  }
  const handleSkipProviderUpdate = (): void => {
    setProviderUpdateSuggestion(null)
    setProviderUpdateError(null)
  }
  const handleNeverSuggestProviderUpdate = (): void => {
    const suggestion = providerUpdateSuggestion
    if (!suggestion) return

    updateProviderUpdatePreference(suggestion.providerId, (preference) => ({
      ...preference,
      neverSuggest: true
    }))
    setProviderUpdateSuggestion(null)
    setProviderUpdateError(null)
  }
  const handleNeverSuggestProviderUpdateVersion = (): void => {
    const suggestion = providerUpdateSuggestion
    if (!suggestion) return

    updateProviderUpdatePreference(suggestion.providerId, (preference) => ({
      ...preference,
      ignoredVersions: Array.from(
        new Set([...preference.ignoredVersions, suggestion.latestVersion])
      )
    }))
    setProviderUpdateSuggestion(null)
    setProviderUpdateError(null)
  }
  const handleUpdateProvider = async (): Promise<void> => {
    const suggestion = providerUpdateSuggestion
    if (!suggestion || providerUpdateState === 'updating') return

    setProviderUpdateState('updating')
    setProviderUpdateError(null)

    try {
      const availability = await providerApi.updateProvider(suggestion.providerId, {
        container: normalizeContainerTarget(newSessionContainer)
      })
      setProviderModelsRevision((revision) => revision + 1)
      setProviderUpdateSuggestion(
        availability &&
          shouldSuggestProviderUpdate(
            providerUpdatePreferences,
            suggestion.providerId,
            availability
          )
          ? { ...availability, providerId: suggestion.providerId }
          : null
      )
    } catch (error) {
      setProviderUpdateError(
        getErrorMessage(error, `Unable to update ${providerLabels[suggestion.providerId]}.`)
      )
    } finally {
      setProviderUpdateState('idle')
    }
  }
  const providerUpdateInProgress = providerUpdateState === 'updating'

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
    handleChatForcedDropdownChange,
    handleChatUsageDisplayChange,
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
  }
}
