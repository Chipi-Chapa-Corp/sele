import type { BrowserSharedOpen, BrowserSyncSnapshot } from './browserSync'
import type { BrowserAutomationTab } from './browser'

export type RemoteBrowserRequest = {
  viewId?: string
  workspaceKey: string
  cwd: string
  method:
    | 'state'
    | 'tabs'
    | 'sync'
    | 'create'
    | 'activate'
    | 'close'
    | 'navigate'
    | 'back'
    | 'forward'
    | 'reload'
    | 'click'
    | 'scroll'
    | 'text'
    | 'key'
    | 'release'
  opens?: BrowserSharedOpen[]
  tabId?: number
  url?: string
  x?: number
  y?: number
  deltaY?: number
  text?: string
  key?: 'Backspace' | 'Enter' | 'Tab' | 'Escape'
}
export type RemoteBrowserState = {
  sync?: BrowserSyncSnapshot
  tabs: BrowserAutomationTab[]
  frame?: {
    dataUrl: string
    width: number
    height: number
    canGoBack: boolean
    canGoForward: boolean
  }
}
