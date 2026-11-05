export type BrowserSharedTab = { id: string; url: string; title: string }
export type BrowserTabsPublication = {
  workspaceKey: string
  active: boolean
  activeTabId: string | null
  tabs: BrowserSharedTab[]
}
export type BrowserSharedOpen = { id: string; url: string }
export type BrowserSharedOpenRequest = BrowserSharedOpen & { workspaceKey: string }
export type BrowserSyncSnapshot = {
  active: boolean
  activeTabId: string | null
  tabs: BrowserSharedTab[]
  accepted: BrowserSharedOpen[]
}
