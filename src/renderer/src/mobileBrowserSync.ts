import type { BrowserSyncSnapshot } from '../../shared/browserSync'
import { mobileBrowserUrl } from './mobileBrowserUrl.ts'
import type { StoredBrowserSession, StoredBrowserTab } from './browserTabs'

export const desktopTabId = (id: string): string =>
  id.startsWith('desktop:') ? id.slice(8) : `mobile:${id}`
const http = (url: string): boolean => /^https?:/.test(url)
/** A URL open is mirrored once; page input, redirects and scroll state stay local. */
export class MobileBrowserSync {
  private seen = new Map<string, string>()
  private sent = new Map<string, string>()
  private queued = new Map<string, string>()
  private own = new Set<string>()
  private closed = new Set<string>()
  constructor(session: StoredBrowserSession) {
    for (const tab of session.tabs)
      if (!tab.id.startsWith('desktop:')) {
        this.own.add(tab.id)
        if (http(tab.url)) this.opened(tab.id, tab.url)
      }
  }
  opened(id: string, url: string): void {
    if (!http(url)) return
    if (!id.startsWith('desktop:')) this.own.add(id)
    const key = desktopTabId(id)
    this.closed.delete(key)
    this.queued.set(key, new URL(url).href)
  }
  close(id: string): void {
    const key = desktopTabId(id)
    this.closed.add(key)
    this.queued.delete(key)
  }
  outgoing(): { id: string; url: string }[] {
    return [...this.queued].map(([id, url]) => ({ id, url }))
  }
  private localId(id: string): string {
    return id.startsWith('mobile:') && this.own.has(id.slice(7)) ? id.slice(7) : `desktop:${id}`
  }
  receive(
    snapshot: BrowserSyncSnapshot,
    origin: string
  ): { tabs: StoredBrowserTab[]; activeTabId: string | null } {
    for (const accepted of snapshot.accepted) {
      this.sent.set(accepted.id, accepted.url)
      if (this.queued.get(accepted.id) === accepted.url) this.queued.delete(accepted.id)
    }
    const tabs: StoredBrowserTab[] = []
    for (const tab of snapshot.tabs) {
      if (!http(tab.url) || this.seen.get(tab.id) === tab.url) continue
      this.seen.set(tab.id, tab.url)
      if (this.closed.has(tab.id) || this.queued.has(tab.id) || this.sent.get(tab.id) === tab.url)
        continue
      tabs.push({ ...tab, id: this.localId(tab.id), url: mobileBrowserUrl(tab.url, origin) })
    }
    return { tabs, activeTabId: snapshot.activeTabId ? this.localId(snapshot.activeTabId) : null }
  }
}
export function mergeBrowserTabs(
  session: StoredBrowserSession,
  update: { tabs: StoredBrowserTab[]; activeTabId: string | null }
): StoredBrowserSession {
  if (!update.tabs.length) return session
  const pristine = session.tabs.every((tab) => !tab.url)
  const tabs = pristine ? [] : [...session.tabs]
  for (const tab of update.tabs) {
    const i = tabs.findIndex((old) => old.id === tab.id)
    if (i < 0) tabs.push(tab)
    else tabs[i] = tab
  }
  return {
    tabs,
    activeTabId: pristine
      ? (tabs.find((tab) => tab.id === update.activeTabId)?.id ?? tabs[0]?.id ?? null)
      : (session.activeTabId ?? tabs[0]?.id ?? null)
  }
}
