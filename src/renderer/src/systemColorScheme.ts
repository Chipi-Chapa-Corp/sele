import type { AppColorScheme } from '../../shared/app'
import { appApi } from './appApi'
import { type AppThemePreference, readStoredAppSettings } from './settings'

const colorSchemeQuery = '(prefers-color-scheme: dark)'
const logPrefix = '[color-scheme:renderer]'
let themePreference: AppThemePreference = readStoredAppSettings().appearance.theme
let systemColorScheme: AppColorScheme = 'light'

const getSystemColorScheme = (query: MediaQueryList): AppColorScheme =>
  query.matches ? 'dark' : 'light'

const getEffectiveColorScheme = (
  preference: AppThemePreference,
  systemScheme: AppColorScheme
): AppColorScheme => (preference === 'system' ? systemScheme : preference)

const applyColorScheme = (scheme: AppColorScheme): void => {
  const root = document.documentElement

  root.dataset.colorScheme = scheme
  root.style.colorScheme = scheme
}

const applyPreferredColorScheme = (): void => {
  applyColorScheme(getEffectiveColorScheme(themePreference, systemColorScheme))
}

export const setThemePreference = (preference: AppThemePreference): void => {
  themePreference = preference
  applyPreferredColorScheme()
}

export const watchSystemColorScheme = (): (() => void) => {
  let disposed = false
  const query = window.matchMedia(colorSchemeQuery)
  const updateColorScheme = (): void => {
    systemColorScheme = getSystemColorScheme(query)
    applyPreferredColorScheme()
  }

  updateColorScheme()
  query.addEventListener('change', updateColorScheme)

  void appApi
    .getColorScheme()
    .then((scheme) => {
      if (disposed) return
      systemColorScheme = scheme
      applyPreferredColorScheme()
    })
    .catch((error: unknown) => {
      console.error(logPrefix, 'failed to read main process color scheme', error)
    })

  const unsubscribe = appApi.onColorSchemeUpdated((scheme) => {
    systemColorScheme = scheme
    applyPreferredColorScheme()
  })
  return () => {
    disposed = true
    query.removeEventListener('change', updateColorScheme)
    unsubscribe()
  }
}
