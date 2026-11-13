import { startTransition, useEffect, useLayoutEffect } from 'react'
import { isExpectedCommandAbsenceError } from '../../../../shared/expectedAbsence.ts'
import { appApi } from '../../appApi'
import { applyFontAppearancePreferences } from '../../fontAppearance'
import { setThemePreference } from '../../systemColorScheme'
import {
  applyShadowPreference,
  applyWindowControlAppearancePreferences
} from '../gitControllerUtils'
import { useWorkspaceSettingsContext } from './useWorkspaceSettingsContext'
import type { WorkspaceState } from '../composition/useWorkspaceState'

export function useWorkspaceAppearance({
  settings,
  preferences
}: WorkspaceState & {
  settings: ReturnType<typeof useWorkspaceSettingsContext>
}) {
  useEffect(() => {
    setThemePreference(settings.effectiveAppSettings.appearance.theme)
  }, [settings.effectiveAppSettings.appearance.theme])

  useEffect(() => {
    let active = true

    void appApi
      .getInstalledFontFamilies()
      .then((families) => {
        startTransition(() => {
          if (active) preferences.setInstalledFontFamilies(families)
        })
      })
      .catch((error: unknown) => {
        if (isExpectedCommandAbsenceError(error)) return
        console.error('Unable to load installed font families.', error)
      })
      .finally(() => {
        startTransition(() => {
          if (active) preferences.setInstalledFontsLoaded(true)
        })
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void appApi
      .setWindowZoomLevel(settings.effectiveAppSettings.appearance.zoomLevel)
      .catch((error: unknown) => {
        console.error('Unable to set the window zoom level.', error)
      })
  }, [settings.effectiveAppSettings.appearance.zoomLevel])

  useLayoutEffect(() => {
    applyShadowPreference(settings.effectiveAppSettings.performance.disableShadows)
  }, [settings.effectiveAppSettings.performance.disableShadows])

  useLayoutEffect(() => {
    applyWindowControlAppearancePreferences(settings.effectiveAppSettings.appearance)
  }, [settings.effectiveAppSettings.appearance])

  useLayoutEffect(() => {
    applyFontAppearancePreferences(settings.effectiveAppSettings.appearance)
  }, [settings.effectiveAppSettings.appearance])
  return {}
}
