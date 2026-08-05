import type { AppSettings } from './settings'
import { appFontInheritValue, appFontMonospaceValue, appFontSystemValue } from './settings'

export const appFontSettingsChangedEvent = 'sele:font-settings-changed'

const applicationFontStack =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const codeFontStack =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"

const toCssFontFamily = (family: string, fallback: string): string => {
  if (!family) return fallback
  if (family === appFontSystemValue) return applicationFontStack
  if (family === appFontMonospaceValue) return codeFontStack
  if (family === appFontInheritValue) return 'var(--application-font-family)'
  return JSON.stringify(family)
}

export const applyFontAppearancePreferences = (appearance: AppSettings['appearance']): void => {
  const root = document.documentElement
  root.style.setProperty(
    '--application-font-family',
    toCssFontFamily(appearance.applicationFont.family, applicationFontStack)
  )
  root.style.setProperty('--application-font-size', `${appearance.applicationFont.size}rem`)
  root.style.setProperty(
    '--chat-font-family',
    toCssFontFamily(appearance.chatFont.family, 'var(--application-font-family)')
  )
  root.style.setProperty('--chat-font-size', `${appearance.chatFont.size}rem`)
  root.style.setProperty(
    '--code-font-family',
    toCssFontFamily(appearance.codeFont.family, codeFontStack)
  )
  root.style.setProperty('--code-font-size', `${appearance.codeFont.size}rem`)
  window.dispatchEvent(new Event(appFontSettingsChangedEvent))
}

export const getCodeFontAppearance = (): { family: string; size: number } => {
  const styles = getComputedStyle(document.documentElement)
  const family = styles.getPropertyValue('--code-font-family').trim() || codeFontStack
  const configuredSize = styles.getPropertyValue('--code-font-size').trim()
  const parsedSize = Number.parseFloat(configuredSize)
  const rootSize = Number.parseFloat(styles.fontSize)
  const size = configuredSize.endsWith('rem') ? parsedSize * rootSize : parsedSize

  return {
    family,
    size: Number.isFinite(size) ? size : 18
  }
}
