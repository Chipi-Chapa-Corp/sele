import { useMemo, useRef, useState } from 'react'
import { readAccountModelPreferences } from '../../accountModelPreferences'
import type { SettingsScope } from '../../components/SettingsDialog'
import { type SettingsTab } from '../../components/SettingsPanel'
import {
  readStoredChatMessageBoxSelections,
  readStoredMessageBoxSelections
} from '../../messageBoxPreferences'
import {
  readStoredAppProjectSettings,
  readStoredAppSettings,
  type AppProjectSettingsByCwd,
  type AppSettings
} from '../../settings'
import { usePreferenceState } from '../../usePreferenceState'

export function useWorkspacePreferenceState() {
  const storedMessageBoxSelections = useMemo(() => readStoredMessageBoxSelections(), [])

  const storedChatMessageBoxSelections = useMemo(() => readStoredChatMessageBoxSelections(), [])

  const storedAccountModelPreferences = useMemo(() => readAccountModelPreferences(), [])

  const storedMessageBoxSelection = storedMessageBoxSelections.codex ?? {}

  const [appSettings, setAppSettings] = usePreferenceState<AppSettings>(readStoredAppSettings)

  const [projectSettingsByCwd, setProjectSettingsByCwd] =
    usePreferenceState<AppProjectSettingsByCwd>(readStoredAppProjectSettings)

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

  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null)

  const settingsOpenRef = useRef(settingsOpen)
  return {
    storedMessageBoxSelections,
    storedChatMessageBoxSelections,
    storedAccountModelPreferences,
    storedMessageBoxSelection,
    appSettings,
    setAppSettings,
    projectSettingsByCwd,
    setProjectSettingsByCwd,
    appearanceZoomLevelInputDraft,
    setAppearanceZoomLevelInputDraft,
    browserDefaultScaleInputDraft,
    setBrowserDefaultScaleInputDraft,
    appearanceFontSizeInputDraft,
    setAppearanceFontSizeInputDraft,
    installedFontFamilies,
    setInstalledFontFamilies,
    installedFontsLoaded,
    setInstalledFontsLoaded,
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    settingsScope,
    setSettingsScope,
    settingsCloseButtonRef,
    settingsOpenRef
  }
}
