import { useCallback, useMemo } from 'react'
import { isNoProjectChat, isNoProjectCwd } from '../../../../shared/noProject'
import {
  isAppProjectSettingOverridden,
  setAppProjectSettingOverrideValue,
  setAppProjectSettingsForCwd,
  type AppProjectSettingPath
} from '../../appProjectSettings'
import type { DropdownOption } from '../../components/Dropdown'
import { isRemoteClient } from '../../runtimeCapabilities'
import {
  normalizeAppAppearanceZoomLevel,
  normalizeAppProjectSettingsCwd,
  resolveAppSettings
} from '../../settings'
import { useWorkspaceChatState } from '../state/useWorkspaceChatState'
import { useWorkspacePreferenceState } from '../state/useWorkspacePreferenceState'
import { useWorkspaceSourceState } from '../state/useWorkspaceSourceState'

type WorkspaceSettingsContextDependencies = {
  chatState: ReturnType<typeof useWorkspaceChatState>
  sourceState: ReturnType<typeof useWorkspaceSourceState>
  preferences: ReturnType<typeof useWorkspacePreferenceState>
}

export function useWorkspaceSettingsContext({
  chatState,
  sourceState,
  preferences
}: WorkspaceSettingsContextDependencies) {
  const selectedChatDetail =
    chatState.chatDetail?.id === chatState.selectedChat?.id ? chatState.chatDetail : null

  const noProject = chatState.selectedChat
    ? isNoProjectChat(selectedChatDetail) || isNoProjectChat(chatState.selectedChat)
    : sourceState.newSessionNoProject

  const selectedProjectCwd = noProject
    ? null
    : chatState.selectedChat
      ? (selectedChatDetail?.projectCwd ??
        chatState.selectedChat.projectCwd ??
        selectedChatDetail?.cwd ??
        chatState.selectedChat.cwd)
      : sourceState.newSessionCwd

  const settingsProjectCwd = normalizeAppProjectSettingsCwd(
    isNoProjectCwd(selectedProjectCwd) ? null : selectedProjectCwd
  )

  const settingsProjectOverrides = settingsProjectCwd
    ? preferences.projectSettingsByCwd[settingsProjectCwd]
    : undefined

  const effectiveAppSettings = useMemo(() => {
    const settings = resolveAppSettings(preferences.appSettings, settingsProjectOverrides)
    return isRemoteClient()
      ? {
          ...settings,
          appearance: { ...settings.appearance, position: 'hidden' as const }
        }
      : settings
  }, [preferences.appSettings, settingsProjectOverrides])

  const settingsViewIsProject =
    preferences.settingsScope === 'project' && Boolean(settingsProjectCwd)

  const settingsPanelSettings = settingsViewIsProject
    ? effectiveAppSettings
    : preferences.appSettings

  const settingsScopeKey =
    settingsViewIsProject && settingsProjectCwd ? `project:${settingsProjectCwd}` : 'global'

  const installedFontOptions = useMemo<DropdownOption<string>[]>(
    () => preferences.installedFontFamilies.map((family) => ({ value: family, label: family })),
    [preferences.installedFontFamilies]
  )

  const updateAppearanceZoomLevel = useCallback(
    (value: number, clearInputDraft = true): void => {
      const zoomLevel = normalizeAppAppearanceZoomLevel(value)
      const zoomPath = { section: 'appearance', key: 'zoomLevel' } satisfies AppProjectSettingPath

      if (clearInputDraft) preferences.setAppearanceZoomLevelInputDraft(null)

      if (
        settingsViewIsProject &&
        settingsProjectCwd &&
        isAppProjectSettingOverridden(settingsProjectOverrides, zoomPath)
      ) {
        preferences.setProjectSettingsByCwd((currentSettings) => {
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

      preferences.setAppSettings((currentSettings) =>
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
  return {
    noProject,
    settingsProjectCwd,
    settingsProjectOverrides,
    effectiveAppSettings,
    settingsViewIsProject,
    settingsPanelSettings,
    settingsScopeKey,
    installedFontOptions,
    updateAppearanceZoomLevel
  }
}
