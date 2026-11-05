import type { RendererClient } from './clientIpc'
import type {
  BrowserSharedOpen,
  BrowserSyncSnapshot,
  BrowserTabsPublication
} from '../shared/browserSync'
import { browserIpcChannels } from '../shared/browser'

type Desktop = {
  owner: RendererClient
  active: string | null
  workspaces: Map<string, BrowserTabsPublication>
  pending: Map<string, string>
}
const desktops = new Map<number, Desktop>()
const http = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 8192) return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
export function publishBrowserTabs(owner: RendererClient, value: unknown): void {
  if (!value || typeof value !== 'object') return
  const snapshot = value as BrowserTabsPublication
  if (
    typeof snapshot.workspaceKey !== 'string' ||
    snapshot.workspaceKey.length > 8192 ||
    typeof snapshot.active !== 'boolean' ||
    !Array.isArray(snapshot.tabs) ||
    snapshot.tabs.length > 100
  )
    return
  const tabs = snapshot.tabs.filter(
    (tab) =>
      tab &&
      typeof tab.id === 'string' &&
      tab.id.length <= 200 &&
      typeof tab.url === 'string' &&
      tab.url.length <= 8192 &&
      typeof tab.title === 'string' &&
      tab.title.length <= 500
  )
  let desktop = desktops.get(owner.id)
  if (!desktop) {
    desktop = { owner, active: null, workspaces: new Map(), pending: new Map() }
    desktops.set(owner.id, desktop)
    owner.once('destroyed', () => desktops.delete(owner.id))
  }
  if (snapshot.active) desktop.active = snapshot.workspaceKey
  else if (desktop.active === snapshot.workspaceKey) desktop.active = null
  desktop.workspaces.set(snapshot.workspaceKey, { ...snapshot, tabs })
  for (const tab of tabs) {
    const key = JSON.stringify([snapshot.workspaceKey, tab.id])
    if (desktop.pending.get(key) === tab.url) desktop.pending.delete(key)
  }
}

/** URL metadata and open intents only. Reading never activates a desktop pane. */
export function syncBrowserTabs(workspaceKey: string, opens: unknown = []): BrowserSyncSnapshot {
  if (!Array.isArray(opens) || opens.length > 100) throw new Error('Invalid browser opens.')
  const requested: BrowserSharedOpen[] = opens.map((value) => {
    if (
      !value ||
      typeof value.id !== 'string' ||
      !value.id ||
      value.id.length > 200 ||
      !http(value.url)
    )
      throw new Error('Invalid browser URL.')
    return { id: value.id, url: value.url }
  })
  const choices = [...desktops.values()].filter(
    (desktop) => !desktop.owner.isDestroyed() && desktop.workspaces.has(workspaceKey)
  )
  const desktop = choices.find((desktop) => desktop.active === workspaceKey) ?? choices[0]
  const state = desktop?.workspaces.get(workspaceKey)
  const active = desktop?.active === workspaceKey
  const accepted: BrowserSharedOpen[] = []
  if (desktop && active)
    for (const open of requested) {
      const key = JSON.stringify([workspaceKey, open.id])
      if (
        !state?.tabs.some((tab) => tab.id === open.id && tab.url === open.url) &&
        desktop.pending.get(key) !== open.url
      ) {
        desktop.pending.set(key, open.url)
        desktop.owner.send(browserIpcChannels.sharedOpen, { workspaceKey, ...open })
      }
      accepted.push(open)
    }
  // An open intent can be acknowledged before the renderer commits its URL.
  // Do not echo the previous page over that newer intent in the meantime.
  const tabs = (state?.tabs ?? []).filter((tab) => {
    const pending = desktop?.pending.get(JSON.stringify([workspaceKey, tab.id]))
    return !pending || pending === tab.url
  })
  return { active, activeTabId: state?.activeTabId ?? null, tabs, accepted }
}
