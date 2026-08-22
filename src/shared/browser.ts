export type BrowserOpenRequest = {
  id: string
  url: string
}

export type BrowserRendererApi = {
  onOpenRequested: (listener: (request: BrowserOpenRequest) => void) => () => void
  onCloseActiveTabRequested: (listener: () => void) => () => void
}

export const browserIpcChannels = {
  openRequested: 'browser:open-requested',
  closeActiveTabRequested: 'browser:close-active-tab-requested'
} as const

export type BrowserCloseShortcutInput = {
  alt?: boolean
  altKey?: boolean
  code?: string
  control?: boolean
  ctrlKey?: boolean
  isAutoRepeat?: boolean
  key?: string
  meta?: boolean
  metaKey?: boolean
  repeat?: boolean
  shift?: boolean
  shiftKey?: boolean
  type?: string
}

export type BrowserCloseShortcutAction = 'close-tab' | 'suppress-window-close'

export const getBrowserCloseShortcutAction = (
  input: BrowserCloseShortcutInput
): BrowserCloseShortcutAction | null => {
  if (input.type && input.type !== 'keyDown' && input.type !== 'keydown') return null
  if (
    input.alt ||
    input.altKey ||
    (!input.control && !input.ctrlKey && !input.meta && !input.metaKey)
  ) {
    return null
  }
  if (input.key?.toLocaleLowerCase() !== 'w' && input.code !== 'KeyW') return null

  return input.shift || input.shiftKey || input.repeat || input.isAutoRepeat
    ? 'suppress-window-close'
    : 'close-tab'
}

const browserPageProtocols = new Set(['http:', 'https:'])

export const isBrowserPageUrl = (value: string): boolean => {
  try {
    return browserPageProtocols.has(new URL(value).protocol)
  } catch {
    return false
  }
}

export const normalizeBrowserAddress = (value: string): string | null => {
  const address = value.trim()
  if (!address) return null

  const candidate = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/?#]|$)/i.test(
    address
  )
    ? `http://${address}`
    : /^[a-z][a-z\d+.-]*:/i.test(address)
      ? address
      : `https://${address}`

  try {
    const url = new URL(candidate)
    return browserPageProtocols.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export const getBrowserPageLabel = (value: string): string => {
  try {
    return new URL(value).hostname || 'New tab'
  } catch {
    return 'New tab'
  }
}

export const getBrowserFaviconUrl = (value: string): string | null => {
  try {
    const url = new URL(value)
    if (!browserPageProtocols.has(url.protocol)) return null

    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(url.origin)}&sz=32`
  } catch {
    return null
  }
}
