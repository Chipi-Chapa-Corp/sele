import { getBrowserPageLabel, isBrowserPageUrl } from '../../shared/browser.ts'

export type StoredBrowserTab = {
  id: string
  title: string
  url: string
}

export type StoredBrowserSession = {
  activeTabId: string | null
  tabs: StoredBrowserTab[]
}

export type StoredBrowserWorkspaces = Record<string, StoredBrowserSession>

export const browserTabsStorageKey = 'sele:browser-tabs:v2'
export const legacyBrowserTabsStorageKey = 'sele:browser-tabs:v1'
const maxStoredBrowserTabs = 100
const maxStoredBrowserWorkspaces = 500
const maxStoredBrowserTabIdLength = 200
const maxStoredBrowserTabTitleLength = 500
const maxStoredBrowserWorkspaceKeyLength = 2_000

const getStoredString = (value: unknown, maxLength: number): string | null =>
  typeof value === 'string' && value.length <= maxLength ? value : null

const parseStoredBrowserSessionValue = (value: unknown): StoredBrowserSession | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const parsed = value as { activeTabId?: unknown; tabs?: unknown }
  if (!Array.isArray(parsed.tabs)) return null

  const seenIds = new Set<string>()
  const tabs = parsed.tabs.slice(0, maxStoredBrowserTabs).flatMap((entry): StoredBrowserTab[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []

    const candidate = entry as { id?: unknown; title?: unknown; url?: unknown }
    const id = getStoredString(candidate.id, maxStoredBrowserTabIdLength)
    const url = getStoredString(candidate.url, 8_192)
    if (!id || url === null || (url !== '' && !isBrowserPageUrl(url)) || seenIds.has(id)) return []

    seenIds.add(id)
    const storedTitle = getStoredString(candidate.title, maxStoredBrowserTabTitleLength)?.trim()
    return [{ id, url, title: storedTitle || (url ? getBrowserPageLabel(url) : 'New tab') }]
  })
  const requestedActiveTabId = getStoredString(parsed.activeTabId, maxStoredBrowserTabIdLength)
  const activeTabId = tabs.some((tab) => tab.id === requestedActiveTabId)
    ? requestedActiveTabId
    : (tabs[0]?.id ?? null)

  return { activeTabId, tabs }
}

export const parseStoredBrowserSession = (value: string | null): StoredBrowserSession | null => {
  if (!value) return null

  try {
    return parseStoredBrowserSessionValue(JSON.parse(value))
  } catch {
    return null
  }
}

export const parseStoredBrowserWorkspaces = (value: string | null): StoredBrowserWorkspaces => {
  if (!value) return {}

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const workspaces: StoredBrowserWorkspaces = {}
    for (const [workspaceKey, sessionValue] of Object.entries(parsed).slice(
      0,
      maxStoredBrowserWorkspaces
    )) {
      if (!workspaceKey || workspaceKey.length > maxStoredBrowserWorkspaceKeyLength) continue

      const session = parseStoredBrowserSessionValue(sessionValue)
      if (session) workspaces[workspaceKey] = session
    }
    return workspaces
  } catch {
    return {}
  }
}

export const readStoredBrowserWorkspaces = (
  legacyWorkspaceKey: string
): StoredBrowserWorkspaces => {
  try {
    const storedWorkspaces = parseStoredBrowserWorkspaces(
      window.localStorage.getItem(browserTabsStorageKey)
    )
    if (Object.keys(storedWorkspaces).length > 0) return storedWorkspaces

    const legacySession = parseStoredBrowserSession(
      window.localStorage.getItem(legacyBrowserTabsStorageKey)
    )
    return legacySession ? { [legacyWorkspaceKey]: legacySession } : {}
  } catch {
    return {}
  }
}

export const writeStoredBrowserWorkspaces = (workspaces: StoredBrowserWorkspaces): void => {
  try {
    window.localStorage.setItem(browserTabsStorageKey, JSON.stringify(workspaces))
    window.localStorage.removeItem(legacyBrowserTabsStorageKey)
  } catch {
    // Browsing remains available when local storage is unavailable or full.
  }
}
