import { MobileBrowserSync, mergeBrowserTabs } from '../mobileBrowserSync'
import type { BrowserSyncSnapshot } from '../../../shared/browserSync'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Globe2 } from 'lucide-react'
import type { BrowserOpenRequest } from '../../../shared/browser'
import { getBrowserPageLabel, normalizeBrowserAddress } from '../../../shared/browser'
import type { LocalAccessApi } from '../../../shared/localAccess'
import type { BrowserAutomationTab } from '../../../shared/browser'
import {
  readStoredBrowserWorkspaces,
  writeStoredBrowserWorkspaces,
  type StoredBrowserSession
} from '../browserTabs'
import { readMobileConnection } from '../mobileConnection'
import { nativeBrowser, type NativeBrowserState } from '../nativeBrowser'
import { BrowserChrome } from './BrowserChrome'
import { Button } from './Button'
import './BrowserPanel.css'

type Props = {
  active: boolean
  workspaceKey: string
  cwd?: string | null
  openRequest?: BrowserOpenRequest | null
}
const emptyRuntime = { loading: false, canGoBack: false, canGoForward: false }
const blank = () => ({ id: crypto.randomUUID(), title: 'New tab', url: '' })
const localAccess = () => (window as unknown as { localAccessApi: LocalAccessApi }).localAccessApi
let listing: Promise<unknown> = Promise.resolve()
const listHostTabs = (workspaceKey: string, cwd: string): Promise<BrowserAutomationTab[]> => {
  const operation = listing
    .catch(() => {})
    .then(async () => {
      const viewId = crypto.randomUUID()
      try {
        try {
          return (
            (await localAccess().remoteBrowser({ method: 'tabs', workspaceKey, cwd, viewId }))
              ?.tabs ?? []
          )
        } catch (error) {
          if (!/Unsupported browser action/i.test(String(error))) throw error
          // Older hosts expose metadata through state. Read it once, without polling or forwarding input.
          return (
            (await localAccess().remoteBrowser({ method: 'state', workspaceKey, cwd, viewId }))
              ?.tabs ?? []
          )
        }
      } finally {
        await localAccess().remoteBrowser({ method: 'release', workspaceKey, cwd, viewId })
      }
    })
  listing = operation
  return operation
}

/** Uses the same chrome as desktop, with an on-device Android WebView. Only
 * URL metadata is shared while active; page rendering and input remain local. */
export function MobileBrowserPanel({
  active,
  workspaceKey,
  cwd = '',
  openRequest
}: Props): React.ReactElement {
  const [workspaces, setWorkspaces] = useState(() => {
    const stored = readStoredBrowserWorkspaces(workspaceKey)
    if (!stored[workspaceKey]) {
      const tab = blank()
      stored[workspaceKey] = { activeTabId: tab.id, tabs: [tab] }
    }
    return stored
  })
  const [runtime, setRuntime] = useState<Record<string, NativeBrowserState>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const opened = useRef(new Set<string>())
  const nativeUrls = useRef(new Map<string, string>())
  const syncs = useRef(new Map<string, MobileBrowserSync>())
  const sessions = useRef(workspaces)
  sessions.current = workspaces
  const wake = useRef<(() => void) | null>(null)
  const [remoteLoads, setRemoteLoads] = useState<Record<string, { url: string }>>({})
  const syncFor = useCallback((key: string): MobileBrowserSync => {
    let sync = syncs.current.get(key)
    if (!sync) {
      sync = new MobileBrowserSync(sessions.current[key] ?? { tabs: [], activeTabId: null })
      syncs.current.set(key, sync)
    }
    return sync
  }, [])
  const phoneOpened = useCallback(
    (key: string, id: string, url: string): void => {
      syncFor(key).opened(id, url)
      queueMicrotask(() => wake.current?.())
    },
    [syncFor]
  )
  const handled = useRef(new Set<string>())
  const session = workspaces[workspaceKey]
  const tab = session?.tabs.find((tab) => tab.id === session.activeTabId)
  const tabId = tab?.id
  const act = (action: 'back' | 'forward' | 'reload' | 'close' | 'external', id = tabId): void => {
    if (id) void nativeBrowser.action({ id, action }).catch((error) => setError(String(error)))
  }
  const updateSession = useCallback(
    (key: string, update: (value: StoredBrowserSession) => StoredBrowserSession) =>
      setWorkspaces((current) => ({
        ...current,
        [key]: update(current[key] ?? { tabs: [], activeTabId: null })
      })),
    []
  )
  const add = useCallback(
    (url = '', key = workspaceKey) => {
      const next = { ...blank(), url, title: url ? getBrowserPageLabel(url) : 'New tab' }
      updateSession(key, (current) => ({
        tabs: [...current.tabs.filter((tab) => tab.url || tab.id !== current.activeTabId), next],
        activeTabId: next.id
      }))
      setError(null)
      if (url) phoneOpened(key, next.id, url)
    },
    [workspaceKey, updateSession, phoneOpened]
  )
  useEffect(() => {
    writeStoredBrowserWorkspaces(workspaces)
  }, [workspaces])
  useEffect(() => {
    let live = true
    let cleanup: (() => void) | undefined
    void nativeBrowser
      .addListener('stateChanged', (state) => {
        if (!live) return
        setRuntime((current) => ({ ...current, [state.id]: state }))
        setWorkspaces((current) =>
          Object.fromEntries(
            Object.entries(current).map(([key, session]) => [
              key,
              {
                ...session,
                tabs: session.tabs.map((tab) =>
                  tab.id === state.id
                    ? {
                        ...tab,
                        url: state.url,
                        title: state.title || getBrowserPageLabel(state.url)
                      }
                    : tab
                )
              }
            ])
          )
        )
        if (nativeUrls.current.get(state.id) !== state.url) {
          nativeUrls.current.set(state.id, state.url)
          if (!(document.hasFocus() && document.activeElement?.matches('.browser-panel__address')))
            setDrafts((current) => ({ ...current, [state.id]: state.url }))
        }
      })
      .then((listener) => {
        if (live) {
          cleanup = () => void listener.remove()
          setReady(true)
        } else void listener.remove()
      })
    return () => {
      live = false
      cleanup?.()
      void nativeBrowser.dispose()
    }
  }, [])
  useEffect(() => {
    if (!active) return
    let stopped = false,
      busy = false,
      dirty = false
    let timer: ReturnType<typeof setTimeout>
    const sync = syncFor(workspaceKey)
    const poll = async (): Promise<void> => {
      if (stopped) return
      if (busy) {
        dirty = true
        return
      }
      busy = true
      clearTimeout(timer)
      try {
        let snapshot: BrowserSyncSnapshot
        try {
          const value = await localAccess().remoteBrowser({
            method: 'sync',
            workspaceKey,
            cwd: cwd ?? '',
            opens: sync.outgoing()
          })
          snapshot = value?.sync ?? { tabs: [], active: false, activeTabId: null, accepted: [] }
        } catch (error) {
          if (!/Unsupported browser action/i.test(String(error))) throw error
          const tabs = await listHostTabs(workspaceKey, cwd ?? '')
          snapshot = {
            tabs: tabs.map((tab) => ({ ...tab, id: String(tab.id) })),
            active: false,
            activeTabId: String(tabs.find((tab) => tab.active)?.id ?? ''),
            accepted: []
          }
        }
        if (stopped) return
        const update = sync.receive(snapshot, readMobileConnection()?.origin ?? location.origin)
        if (update.tabs.length) {
          setRemoteLoads((current) => ({
            ...current,
            ...Object.fromEntries(update.tabs.map((tab) => [tab.id, { url: tab.url }]))
          }))
          updateSession(workspaceKey, (current) => mergeBrowserTabs(current, update))
        }
      } catch (error) {
        if (!stopped) console.warn('Unable to synchronize browser URLs.', error)
      } finally {
        busy = false
        if (!stopped) {
          const immediate = dirty
          dirty = false
          timer = setTimeout(() => void poll(), immediate ? 0 : 1000)
        }
      }
    }
    wake.current = () => void poll()
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
      wake.current = null
    }
  }, [active, workspaceKey, cwd, syncFor, updateSession])
  useEffect(() => {
    let live = true
    let cleanup: (() => void) | undefined
    void nativeBrowser
      .addListener('urlOpened', (event) => {
        if (!live) return
        const owner = Object.entries(sessions.current).find(([, session]) =>
          session.tabs.some((tab) => tab.id === event.id)
        )?.[0]
        if (owner) phoneOpened(owner, event.id, event.url)
      })
      .then((listener) => {
        if (live) cleanup = () => void listener.remove()
        else void listener.remove()
      })
    return () => {
      live = false
      cleanup?.()
    }
  }, [phoneOpened])
  useEffect(() => {
    if (!openRequest || handled.current.has(openRequest.id)) return
    handled.current.add(openRequest.id)
    add(openRequest.url)
  }, [openRequest, add])
  const loadRequest = tabId ? remoteLoads[tabId] : undefined
  useEffect(() => {
    if (!ready || !active || !tab?.url) return
    if (opened.current.has(tab.id) && !loadRequest) return
    opened.current.add(tab.id)
    const url = loadRequest?.url ?? tab.url
    if (loadRequest)
      setRemoteLoads((current) => {
        const next = { ...current }
        delete next[tab.id]
        return next
      })
    void nativeBrowser.open({ id: tab.id, url }).catch((error) => setError(String(error)))
  }, [ready, active, tab?.id, tab?.url, loadRequest])
  useEffect(() => {
    const element = viewport.current
    if (!ready || !element) return
    let frame = 0
    let previous = ''
    let settled: ReturnType<typeof setTimeout>
    const update = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect()
        const shell = document.querySelector('main.chat')
        const sidebar = document.getElementById('sidebar')
        const blocked = [
          ...document.querySelectorAll(
            'dialog[open], [role="dialog"]:not([data-mobile-sidebar]), [role="menu"], [role="listbox"], .ui-button-menu-root'
          )
        ].some((e) => e.getClientRects().length > 0)
        const visible = Boolean(
          active &&
            !error &&
            !(tabId && runtime[tabId]?.error) &&
            tabId &&
            opened.current.has(tabId) &&
            shell?.getAttribute('data-mobile-pane') === 'workspace' &&
            !blocked &&
            (!sidebar || getComputedStyle(sidebar).visibility === 'hidden') &&
            rect.width > 0 &&
            rect.height > 0
        )
        const options = {
          id: tabId ?? '',
          url: tab?.url ?? '',
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          viewportWidth: innerWidth,
          visible,
          radius: parseFloat(getComputedStyle(element).borderRadius) || 0
        }
        const signature = JSON.stringify(options)
        if (signature === previous) return
        previous = signature
        void nativeBrowser
          .viewport(options)
          .catch((error) => console.warn('Unable to place phone browser.', error))
      })
    }
    const changed = (): void => {
      update()
      clearTimeout(settled)
      settled = setTimeout(update, 220)
    }
    const resize = new ResizeObserver(changed)
    resize.observe(element)
    const observer = new MutationObserver(changed)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-mobile-pane', 'open', 'inert', 'aria-hidden']
    })
    window.addEventListener('resize', changed)
    window.addEventListener('scroll', changed, true)
    update()
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settled)
      resize.disconnect()
      observer.disconnect()
      window.removeEventListener('resize', changed)
      window.removeEventListener('scroll', changed, true)
      void nativeBrowser.hide()
    }
  }, [ready, active, tabId, tab?.url, error, tabId ? runtime[tabId]?.error : null])
  const navigate = (): void => {
    if (!tab) return
    const url = normalizeBrowserAddress(drafts[tab.id] ?? tab.url)
    if (!url) {
      setError('Enter an HTTP or HTTPS address.')
      return
    }
    setError(null)
    document
      .querySelector<HTMLInputElement>('.browser-panel--mobile .browser-panel__address')
      ?.blur()
    opened.current.add(tab.id)
    phoneOpened(workspaceKey, tab.id, url)
    updateSession(workspaceKey, (current) => ({
      ...current,
      tabs: current.tabs.map((t) => (t.id === tab.id ? { ...t, url } : t))
    }))
    void nativeBrowser.open({ id: tab.id, url }).catch((error) => setError(String(error)))
  }
  return (
    <section className="browser-panel browser-panel--mobile" aria-label="Browser">
      <BrowserChrome
        tabs={session?.tabs ?? []}
        activeTabId={tabId ?? null}
        activeRuntime={tabId ? (runtime[tabId] ?? emptyRuntime) : emptyRuntime}
        addressDraft={tabId ? (drafts[tabId] ?? tab?.url ?? '') : ''}
        onSelectTab={(id) => {
          setError(null)
          updateSession(workspaceKey, (current) => ({ ...current, activeTabId: id }))
        }}
        onCloseTab={(id) => {
          act('close', id)
          syncFor(workspaceKey).close(id)
          opened.current.delete(id)
          updateSession(workspaceKey, (current) => ({
            tabs: current.tabs.filter((tab) => tab.id !== id),
            activeTabId:
              current.activeTabId === id
                ? (current.tabs.find((tab) => tab.id !== id)?.id ?? null)
                : current.activeTabId
          }))
        }}
        onNewTab={() => add()}
        onNavigate={navigate}
        onBack={() => act('back')}
        onForward={() => act('forward')}
        onReload={() => act('reload')}
        onAddressChange={(value) => {
          if (tabId) setDrafts((current) => ({ ...current, [tabId]: value }))
        }}
        onExternal={() => act('external')}
        externalLabel="Open in browser"
      />
      <div className="browser-panel__workspace" ref={viewport}>
        {error || (tabId && runtime[tabId]?.error) ? (
          <div className="browser-panel__page-message browser-panel__page-message--error">
            <p role="alert">{error || runtime[tabId!]?.error}</p>
            <Button
              label="Retry"
              theme="secondary"
              callback={() => {
                setError(null)
                if (tab) void nativeBrowser.open({ id: tab.id, url: tab.url })
              }}
            />
          </div>
        ) : !tab?.url ? (
          <div className="browser-panel__page-message">
            <Globe2 />
            <p>Enter an address to browse.</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
