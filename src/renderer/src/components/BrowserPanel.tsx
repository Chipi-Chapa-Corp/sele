import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Globe2,
  Plus,
  RefreshCw,
  X
} from 'lucide-react'
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  FoundInPageEvent,
  PageTitleUpdatedEvent,
  WebviewTag
} from 'electron'
import { appWindowZoomLevelToFactor } from '../../../shared/app'
import type { BrowserOpenRequest, BrowserPageShortcutRequest } from '../../../shared/browser'
import {
  getBrowserFaviconUrl,
  getBrowserPageLabel,
  getBrowserPageHostname,
  getBrowserPageZoomFactor,
  isBrowserPageUrl,
  normalizeBrowserAddress
} from '../../../shared/browser'
import { browserApi } from '../browserApi'
import {
  readStoredBrowserWorkspaces,
  writeStoredBrowserWorkspaces,
  type StoredBrowserTab
} from '../browserTabs'
import { Button } from './Button'
import { Input } from './Input'
import { SegmentedControl } from './SegmentedControl'
import './BrowserPanel.css'

type BrowserPanelProps = {
  active: boolean
  appZoomLevel: number
  defaultScale: number
  openRequest?: BrowserOpenRequest | null
  workspaceKey: string
}

type BrowserTab = {
  id: string
  initialUrl: string
  loaded: boolean
  title: string
  url: string
  error: string | null
}

type BrowserTabRuntime = {
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

type BrowserWorkspace = {
  activeTabId: string | null
  tabs: BrowserTab[]
}

type BrowserPageStateChange = Partial<BrowserTabRuntime> & {
  error?: string | null
  title?: string
  url?: string
}

type BrowserPageProps = {
  applicationZoomFactor: number
  defaultScale: number
  tab: BrowserTab
  visible: boolean
  onElementChange: (tabId: string, element: WebviewTag | null) => void
  onFindResult: (tabId: string, event: FoundInPageEvent) => void
  onStateChange: (tabId: string, change: BrowserPageStateChange) => void
}

const emptyBrowserRuntime: BrowserTabRuntime = {
  canGoBack: false,
  canGoForward: false,
  loading: false
}

const emptyBrowserFindResult = {
  activeMatchOrdinal: 0,
  matches: 0
}

const createBrowserTab = (
  url = '',
  options: { id?: string; loaded?: boolean; title?: string } = {}
): BrowserTab => ({
  id: options.id ?? crypto.randomUUID(),
  initialUrl: url || 'about:blank',
  loaded: options.loaded ?? true,
  title: options.title?.trim() || (url ? getBrowserPageLabel(url) : 'New tab'),
  url,
  error: null
})

const restoreBrowserTab = (tab: StoredBrowserTab): BrowserTab =>
  createBrowserTab(tab.url, {
    id: tab.id,
    loaded: false,
    title: tab.title
  })

const createInitialBrowserWorkspaces = (
  workspaceKey: string,
  openRequest: BrowserOpenRequest | null
): Map<string, BrowserWorkspace> => {
  const workspaces = new Map<string, BrowserWorkspace>(
    Object.entries(readStoredBrowserWorkspaces(workspaceKey)).map(([storedKey, session]) => [
      storedKey,
      {
        activeTabId: session.activeTabId,
        tabs: session.tabs.map(restoreBrowserTab)
      }
    ])
  )
  const storedWorkspace = workspaces.get(workspaceKey)
  let tabs = storedWorkspace?.tabs ?? []
  let activeTabId = storedWorkspace?.activeTabId ?? tabs[0]?.id ?? null

  if (openRequest && isBrowserPageUrl(openRequest.url)) {
    const requestedTab = createBrowserTab(openRequest.url)
    tabs = [...tabs, requestedTab]
    activeTabId = requestedTab.id
  } else if (tabs.length === 0) {
    const blankTab = createBrowserTab()
    tabs = [blankTab]
    activeTabId = blankTab.id
  }

  tabs = tabs.map((tab) => (tab.id === activeTabId ? { ...tab, loaded: true } : tab))
  workspaces.set(workspaceKey, { activeTabId, tabs })
  return workspaces
}

const getBrowserErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Unable to load this page.'

const BrowserTabIcon: React.FC<{ url: string }> = ({ url }) => {
  const faviconUrl = getBrowserFaviconUrl(url)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (!faviconUrl || failedUrl === faviconUrl) return <Globe2 aria-hidden="true" />

  return (
    <img
      alt=""
      aria-hidden="true"
      className="browser-panel__tab-favicon"
      draggable={false}
      src={faviconUrl}
      onError={() => setFailedUrl(faviconUrl)}
    />
  )
}

const BrowserPage: React.FC<BrowserPageProps> = ({
  applicationZoomFactor,
  defaultScale,
  tab,
  visible,
  onElementChange,
  onFindResult,
  onStateChange
}) => {
  const webviewRef = useRef<WebviewTag>(null)
  const hasPage = Boolean(tab.url)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    onElementChange(tab.id, webview)

    const updateNavigationState = (): void => {
      try {
        onStateChange(tab.id, {
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward()
        })
      } catch {
        // The guest may not be attached yet or may have just been destroyed.
      }
    }
    const handleStartLoading = (): void => {
      onStateChange(tab.id, { loading: true, error: null })
      updateNavigationState()
    }
    const handleStopLoading = (): void => {
      onStateChange(tab.id, { loading: false })
      updateNavigationState()
    }
    const handleNavigate = (event: DidNavigateEvent): void => {
      onStateChange(tab.id, { url: event.url })
      updateNavigationState()
    }
    const handleNavigateInPage = (event: DidNavigateInPageEvent): void => {
      if (!event.isMainFrame) return
      onStateChange(tab.id, { url: event.url })
      updateNavigationState()
    }
    const handleTitleUpdated = (event: PageTitleUpdatedEvent): void => {
      onStateChange(tab.id, { title: event.title })
    }
    const handleFailLoad = (event: DidFailLoadEvent): void => {
      if (!event.isMainFrame || event.errorCode === -3) return
      onStateChange(tab.id, {
        loading: false,
        error: event.errorDescription || 'Unable to load this page.'
      })
      updateNavigationState()
    }
    const handleFoundInPage = (event: FoundInPageEvent): void => onFindResult(tab.id, event)

    webview.addEventListener('dom-ready', updateNavigationState)
    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigateInPage)
    webview.addEventListener('page-title-updated', handleTitleUpdated)
    webview.addEventListener('did-fail-load', handleFailLoad)
    webview.addEventListener('found-in-page', handleFoundInPage)

    return () => {
      onElementChange(tab.id, null)
      webview.removeEventListener('dom-ready', updateNavigationState)
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigateInPage)
      webview.removeEventListener('page-title-updated', handleTitleUpdated)
      webview.removeEventListener('did-fail-load', handleFailLoad)
      webview.removeEventListener('found-in-page', handleFoundInPage)
    }
  }, [hasPage, onElementChange, onFindResult, onStateChange, tab.id])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return
    let current = true

    const setPageScale = (scale: number): void => {
      try {
        webview.setZoomFactor(getBrowserPageZoomFactor(scale, applicationZoomFactor))
      } catch {
        // The guest may not be attached yet or may have just been destroyed.
      }
    }
    const applyPageScale = (): void => {
      let url: string
      try {
        url = webview.getURL()
      } catch {
        return
      }

      const hostname = getBrowserPageHostname(url)
      setPageScale(defaultScale)

      let webContentsId: number
      try {
        webContentsId = webview.getWebContentsId()
      } catch {
        return
      }

      void browserApi
        .resolvePageZoomScale({ defaultScale, url, webContentsId })
        .then((resolvedScale) => {
          if (!current) return

          let currentHostname: string | null = null
          try {
            currentHostname = getBrowserPageHostname(webview.getURL())
          } catch {
            return
          }
          if (currentHostname === hostname) setPageScale(resolvedScale)
        })
        .catch(() => {})
    }

    applyPageScale()
    webview.addEventListener('did-attach', applyPageScale)
    webview.addEventListener('dom-ready', applyPageScale)

    return () => {
      current = false
      webview.removeEventListener('did-attach', applyPageScale)
      webview.removeEventListener('dom-ready', applyPageScale)
    }
  }, [applicationZoomFactor, defaultScale, hasPage])

  useEffect(() => {
    if (!visible) return

    const frame = requestAnimationFrame(() => webviewRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [visible])

  const webviewAttributes = {
    partition: 'persist:sele-browser',
    src: tab.initialUrl
  }

  return (
    <div
      className={`browser-panel__page${visible ? ' browser-panel__page--active' : ''}`}
      aria-label={tab.title}
      hidden={!visible}
      role="region"
    >
      {hasPage && (
        <webview className="browser-panel__webview" ref={webviewRef} {...webviewAttributes} />
      )}
      {!tab.url && !tab.error && (
        <div className="browser-panel__page-message">
          <Globe2 aria-hidden="true" />
          <p>Enter an address to browse.</p>
        </div>
      )}
      {tab.error && (
        <div className="browser-panel__page-message browser-panel__page-message--error">
          <Globe2 aria-hidden="true" />
          <p>{tab.error}</p>
        </div>
      )}
    </div>
  )
}

export const BrowserPanel: React.FC<BrowserPanelProps> = ({
  active,
  appZoomLevel,
  defaultScale,
  openRequest = null,
  workspaceKey
}) => {
  const applicationZoomFactor = appWindowZoomLevelToFactor(appZoomLevel)
  const handledOpenRequestIdsRef = useRef(
    new Set(openRequest && isBrowserPageUrl(openRequest.url) ? [openRequest.id] : [])
  )
  const webviewsRef = useRef(new Map<string, WebviewTag>())
  const findInputRef = useRef<HTMLInputElement>(null)
  const findRequestIdRef = useRef<number | null>(null)
  const browserActiveRef = useRef(active)
  const activeTabIdRef = useRef<string | null>(null)
  const activeTabUrlRef = useRef<string | null>(null)
  const findQueryRef = useRef('')
  const [workspaces, setWorkspaces] = useState(() =>
    createInitialBrowserWorkspaces(workspaceKey, openRequest)
  )
  const [runtimes, setRuntimes] = useState<Map<string, BrowserTabRuntime>>(() => new Map())
  const [addressDrafts, setAddressDrafts] = useState<Record<string, string>>({})
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState(emptyBrowserFindResult)

  const workspace = workspaces.get(workspaceKey) ?? null
  const tabs = workspace?.tabs ?? []
  const activeTabId = workspace?.activeTabId ?? null
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const activeRuntime = activeTabId
    ? (runtimes.get(activeTabId) ?? emptyBrowserRuntime)
    : emptyBrowserRuntime
  const addressDraft = activeTab ? (addressDrafts[activeTab.id] ?? activeTab.url) : ''
  const findResultLabel = findQuery
    ? findResult.matches > 0
      ? `${findResult.activeMatchOrdinal} of ${findResult.matches}`
      : 'No results'
    : ''

  useEffect(() => {
    browserActiveRef.current = active
    activeTabIdRef.current = activeTabId
    activeTabUrlRef.current = activeTab?.url ?? null
    findQueryRef.current = findQuery
  }, [active, activeTab?.url, activeTabId, findQuery])

  useEffect(() => {
    browserApi.setActive(active)
    return () => {
      if (active) browserApi.setActive(false)
    }
  }, [active])

  useEffect(() => {
    writeStoredBrowserWorkspaces(
      Object.fromEntries(
        Array.from(workspaces, ([currentWorkspaceKey, currentWorkspace]) => [
          currentWorkspaceKey,
          {
            activeTabId: currentWorkspace.activeTabId,
            tabs: currentWorkspace.tabs.map(({ id, title, url }) => ({ id, title, url }))
          }
        ])
      )
    )
  }, [workspaces])

  useEffect(() => {
    if (!active) return

    let current = true
    queueMicrotask(() => {
      if (!current) return
      setWorkspaces((currentWorkspaces) => {
        const currentWorkspace = currentWorkspaces.get(workspaceKey)
        if (!currentWorkspace) {
          const blankTab = createBrowserTab()
          const nextWorkspaces = new Map(currentWorkspaces)
          nextWorkspaces.set(workspaceKey, { activeTabId: blankTab.id, tabs: [blankTab] })
          return nextWorkspaces
        }

        const activeTabIndex = currentWorkspace.tabs.findIndex(
          (tab) => tab.id === currentWorkspace.activeTabId
        )
        const currentActiveTab = currentWorkspace.tabs[activeTabIndex]
        if (!currentActiveTab || currentActiveTab.loaded) return currentWorkspaces

        const nextTabs = [...currentWorkspace.tabs]
        nextTabs[activeTabIndex] = {
          ...currentActiveTab,
          initialUrl: currentActiveTab.url || 'about:blank',
          loaded: true
        }
        const nextWorkspaces = new Map(currentWorkspaces)
        nextWorkspaces.set(workspaceKey, { ...currentWorkspace, tabs: nextTabs })
        return nextWorkspaces
      })
    })

    return () => {
      current = false
    }
  }, [active, workspaceKey])

  useEffect(() => {
    if (!openRequest || handledOpenRequestIdsRef.current.has(openRequest.id)) return
    handledOpenRequestIdsRef.current.add(openRequest.id)
    if (!isBrowserPageUrl(openRequest.url)) return

    const tab = createBrowserTab(openRequest.url)
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setWorkspaces((currentWorkspaces) => {
        const currentWorkspace = currentWorkspaces.get(workspaceKey) ?? {
          activeTabId: null,
          tabs: []
        }
        const nextWorkspaces = new Map(currentWorkspaces)
        nextWorkspaces.set(workspaceKey, {
          activeTabId: tab.id,
          tabs: [...currentWorkspace.tabs, tab]
        })
        return nextWorkspaces
      })
    })

    return () => {
      active = false
    }
  }, [openRequest, workspaceKey])

  const handleElementChange = useCallback((tabId: string, element: WebviewTag | null): void => {
    if (element) {
      webviewsRef.current.set(tabId, element)
    } else {
      webviewsRef.current.delete(tabId)
    }
  }, [])

  const handleFindResult = useCallback((tabId: string, event: FoundInPageEvent): void => {
    if (tabId !== activeTabIdRef.current || event.result.requestId !== findRequestIdRef.current) {
      return
    }

    setFindResult({
      activeMatchOrdinal: event.result.activeMatchOrdinal,
      matches: event.result.matches
    })
  }, [])

  const handlePageStateChange = useCallback(
    (tabId: string, change: BrowserPageStateChange): void => {
      if (
        change.canGoBack !== undefined ||
        change.canGoForward !== undefined ||
        change.loading !== undefined
      ) {
        setRuntimes((currentRuntimes) => {
          const currentRuntime = currentRuntimes.get(tabId) ?? emptyBrowserRuntime
          const nextRuntime = {
            canGoBack: change.canGoBack ?? currentRuntime.canGoBack,
            canGoForward: change.canGoForward ?? currentRuntime.canGoForward,
            loading: change.loading ?? currentRuntime.loading
          }
          if (
            nextRuntime.canGoBack === currentRuntime.canGoBack &&
            nextRuntime.canGoForward === currentRuntime.canGoForward &&
            nextRuntime.loading === currentRuntime.loading
          ) {
            return currentRuntimes
          }

          const nextRuntimes = new Map(currentRuntimes)
          nextRuntimes.set(tabId, nextRuntime)
          return nextRuntimes
        })
      }

      if (change.url === undefined && change.title === undefined && change.error === undefined) {
        return
      }

      if (change.url !== undefined) {
        setAddressDrafts((currentDrafts) =>
          currentDrafts[tabId] === change.url
            ? currentDrafts
            : { ...currentDrafts, [tabId]: change.url ?? '' }
        )
      }

      setWorkspaces((currentWorkspaces) => {
        for (const [currentWorkspaceKey, currentWorkspace] of currentWorkspaces) {
          const tabIndex = currentWorkspace.tabs.findIndex((tab) => tab.id === tabId)
          if (tabIndex < 0) continue

          const tab = currentWorkspace.tabs[tabIndex]
          const url = change.url ?? tab.url
          const navigated = change.url !== undefined && change.url !== tab.url
          const title = change.title?.trim() || (navigated ? getBrowserPageLabel(url) : tab.title)
          const nextTabs = [...currentWorkspace.tabs]
          nextTabs[tabIndex] = {
            ...tab,
            initialUrl: change.url !== undefined && !tab.url ? url : tab.initialUrl,
            url,
            title,
            error: change.error === undefined ? tab.error : change.error
          }
          const nextWorkspaces = new Map(currentWorkspaces)
          nextWorkspaces.set(currentWorkspaceKey, { ...currentWorkspace, tabs: nextTabs })
          return nextWorkspaces
        }

        return currentWorkspaces
      })
    },
    [setAddressDrafts]
  )

  const handleFocusTab = useCallback(
    (tabId: string): void => {
      setWorkspaces((currentWorkspaces) => {
        const currentWorkspace = currentWorkspaces.get(workspaceKey)
        if (!currentWorkspace) return currentWorkspaces

        const nextWorkspaces = new Map(currentWorkspaces)
        nextWorkspaces.set(workspaceKey, {
          activeTabId: tabId,
          tabs: currentWorkspace.tabs.map((tab) =>
            tab.id === tabId && !tab.loaded
              ? { ...tab, initialUrl: tab.url || 'about:blank', loaded: true }
              : tab
          )
        })
        return nextWorkspaces
      })
    },
    [workspaceKey]
  )

  const handleAddTab = (): void => {
    const tab = createBrowserTab()
    setWorkspaces((currentWorkspaces) => {
      const currentWorkspace = currentWorkspaces.get(workspaceKey) ?? {
        activeTabId: null,
        tabs: []
      }
      const nextWorkspaces = new Map(currentWorkspaces)
      nextWorkspaces.set(workspaceKey, {
        activeTabId: tab.id,
        tabs: [...currentWorkspace.tabs, tab]
      })
      return nextWorkspaces
    })
  }

  const handleCloseTab = useCallback((closingWorkspaceKey: string, tabId: string): void => {
    setWorkspaces((currentWorkspaces) => {
      const currentWorkspace = currentWorkspaces.get(closingWorkspaceKey)
      if (!currentWorkspace) return currentWorkspaces

      const closingIndex = currentWorkspace.tabs.findIndex((tab) => tab.id === tabId)
      if (closingIndex < 0) return currentWorkspaces

      const nextActiveTabId =
        currentWorkspace.activeTabId === tabId
          ? (currentWorkspace.tabs[closingIndex + 1]?.id ??
            currentWorkspace.tabs[closingIndex - 1]?.id ??
            null)
          : currentWorkspace.activeTabId
      const nextWorkspaces = new Map(currentWorkspaces)
      nextWorkspaces.set(closingWorkspaceKey, {
        activeTabId: nextActiveTabId,
        tabs: currentWorkspace.tabs
          .filter((tab) => tab.id !== tabId)
          .map((tab) =>
            tab.id === nextActiveTabId && !tab.loaded
              ? { ...tab, initialUrl: tab.url || 'about:blank', loaded: true }
              : tab
          )
      })
      return nextWorkspaces
    })
    setRuntimes((currentRuntimes) => {
      if (!currentRuntimes.has(tabId)) return currentRuntimes
      const nextRuntimes = new Map(currentRuntimes)
      nextRuntimes.delete(tabId)
      return nextRuntimes
    })
  }, [])

  useEffect(
    () =>
      browserApi.onCloseActiveTabRequested(() => {
        if (active && activeTabId) handleCloseTab(workspaceKey, activeTabId)
      }),
    [active, activeTabId, handleCloseTab, workspaceKey]
  )

  const openPageFind = useCallback((): void => {
    if (!activeTabIdRef.current) return

    setFindOpen(true)
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus({ preventScroll: true })
      findInputRef.current?.select()
    })
  }, [])

  const closePageFind = useCallback((): void => {
    const activeTabId = activeTabIdRef.current
    const webview = activeTabId ? webviewsRef.current.get(activeTabId) : null
    try {
      webview?.stopFindInPage('clearSelection')
    } catch {
      // The guest may have just navigated or been destroyed.
    }
    findRequestIdRef.current = null
    setFindOpen(false)
    setFindResult(emptyBrowserFindResult)
    window.requestAnimationFrame(() => webview?.focus())
  }, [])

  const findNext = useCallback((forward: boolean): void => {
    const activeTabId = activeTabIdRef.current
    const findQuery = findQueryRef.current
    if (!activeTabId || !findQuery) return

    const webview = webviewsRef.current.get(activeTabId)
    if (!webview) return

    try {
      findRequestIdRef.current = webview.findInPage(findQuery, {
        findNext: false,
        forward
      })
    } catch {
      // The guest may have just navigated or been destroyed.
    }
  }, [])

  const handlePageShortcut = useCallback(
    (request: BrowserPageShortcutRequest): void => {
      const activeTabId = activeTabIdRef.current
      if (!browserActiveRef.current || !activeTabId) return

      const webview = webviewsRef.current.get(activeTabId)
      if (!webview) return
      if (request.webContentsId !== null) {
        try {
          if (webview.getWebContentsId() !== request.webContentsId) return
        } catch {
          return
        }
      }

      if (request.action === 'find') {
        openPageFind()
      } else if (activeTabUrlRef.current) {
        webview.reload()
      }
    },
    [openPageFind]
  )

  useEffect(() => browserApi.onPageShortcutRequested(handlePageShortcut), [handlePageShortcut])

  useEffect(() => {
    if (!findOpen || !activeTabId) return

    const webview = webviewsRef.current.get(activeTabId)
    if (!webview) return

    findRequestIdRef.current = null
    setFindResult(emptyBrowserFindResult)
    try {
      webview.stopFindInPage('clearSelection')
    } catch {
      return
    }
    if (!findQuery || activeRuntime.loading) return

    let requestId: number
    try {
      requestId = webview.findInPage(findQuery, {
        findNext: true,
        forward: true
      })
      findRequestIdRef.current = requestId
    } catch {
      return
    }

    return () => {
      if (findRequestIdRef.current === requestId) findRequestIdRef.current = null
      try {
        webview.stopFindInPage('clearSelection')
      } catch {
        // The guest may have just navigated or been destroyed.
      }
    }
  }, [activeRuntime.loading, activeTabId, findOpen, findQuery])

  const navigateToAddress = (): void => {
    if (!activeTab) return

    const url = normalizeBrowserAddress(addressDraft)
    if (!url) {
      handlePageStateChange(activeTab.id, {
        error: 'Enter a valid HTTP or HTTPS address.'
      })
      return
    }

    setAddressDrafts((currentDrafts) => ({ ...currentDrafts, [activeTab.id]: url }))
    handlePageStateChange(activeTab.id, {
      error: null,
      loading: true,
      title: getBrowserPageLabel(url),
      url
    })
    const webview = webviewsRef.current.get(activeTab.id)
    if (!webview) return

    void webview.loadURL(url).catch((error) => {
      handlePageStateChange(activeTab.id, {
        error: getBrowserErrorMessage(error),
        loading: false
      })
    })
  }

  return (
    <section className="browser-panel" aria-label="Browser">
      <div className="browser-panel__tab-toolbar">
        <SegmentedControl
          aria-label="Browser tabs"
          className="browser-panel__tabs"
          options={tabs.map((tab) => ({
            value: tab.id,
            label: tab.title,
            ariaLabel: tab.title,
            title: tab.title,
            icon: <BrowserTabIcon url={tab.url} />,
            actionAriaLabel: `Close ${tab.title}`,
            actionTitle: `Close ${tab.title}`,
            actionIcon: <X aria-hidden="true" />,
            actionCallback: () => handleCloseTab(workspaceKey, tab.id)
          }))}
          value={activeTabId ?? ''}
          onChange={handleFocusTab}
        />
        <Button
          aria-label="New browser tab"
          callback={handleAddTab}
          icon={<Plus aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="New browser tab"
        />
      </div>
      <form
        className="browser-panel__navigation"
        aria-label="Browser navigation"
        onSubmit={(event) => {
          event.preventDefault()
          navigateToAddress()
        }}
      >
        <Button
          aria-label="Back"
          callback={() => webviewsRef.current.get(activeTabId ?? '')?.goBack()}
          disabled={!activeTab || !activeRuntime.canGoBack}
          icon={<ArrowLeft aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="Back"
        />
        <Button
          aria-label="Forward"
          callback={() => webviewsRef.current.get(activeTabId ?? '')?.goForward()}
          disabled={!activeTab || !activeRuntime.canGoForward}
          icon={<ArrowRight aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="Forward"
        />
        <Button
          aria-label="Reload"
          callback={() => webviewsRef.current.get(activeTabId ?? '')?.reload()}
          disabled={!activeTab || !activeTab.url}
          icon={
            <RefreshCw
              aria-hidden="true"
              className={activeRuntime.loading ? 'browser-panel__loading-icon' : undefined}
            />
          }
          size="small"
          theme="transparent"
          title="Reload"
        />
        <Input
          aria-label="Address"
          autoCapitalize="off"
          autoComplete="off"
          className="browser-panel__address"
          disabled={!activeTab}
          placeholder="Enter an address"
          spellCheck={false}
          type="text"
          value={addressDraft}
          onChange={(event) => {
            if (!activeTab) return
            const value = event.currentTarget.value
            setAddressDrafts((currentDrafts) => ({
              ...currentDrafts,
              [activeTab.id]: value
            }))
          }}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            if (activeTab) {
              setAddressDrafts((currentDrafts) => ({
                ...currentDrafts,
                [activeTab.id]: activeTab.url
              }))
            }
            event.currentTarget.blur()
          }}
        />
      </form>
      {findOpen && (
        <form
          className="browser-panel__find"
          role="search"
          aria-label="Find in page"
          onSubmit={(event) => {
            event.preventDefault()
            findNext(true)
          }}
        >
          <Input
            ref={findInputRef}
            aria-label="Find in page"
            autoComplete="off"
            className="browser-panel__find-input"
            placeholder="Find in page"
            spellCheck={false}
            type="search"
            value={findQuery}
            onChange={(event) => {
              const value = event.currentTarget.value
              findQueryRef.current = value
              setFindQuery(value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closePageFind()
              } else if (event.key === 'Enter') {
                event.preventDefault()
                findNext(!event.shiftKey)
              }
            }}
          />
          <span className="browser-panel__find-result" aria-live="polite">
            {findResultLabel}
          </span>
          <Button
            aria-label="Previous match"
            callback={() => findNext(false)}
            disabled={!findQuery || findResult.matches === 0}
            icon={<ChevronUp aria-hidden="true" />}
            size="small"
            theme="transparent"
            title="Previous match"
          />
          <Button
            aria-label="Next match"
            callback={() => findNext(true)}
            disabled={!findQuery || findResult.matches === 0}
            icon={<ChevronDown aria-hidden="true" />}
            size="small"
            theme="transparent"
            title="Next match"
          />
          <Button
            aria-label="Close page search"
            callback={closePageFind}
            icon={<X aria-hidden="true" />}
            size="small"
            theme="transparent"
            title="Close page search"
          />
        </form>
      )}
      <div className="browser-panel__workspace">
        {tabs.length === 0 && (
          <div className="browser-panel__empty">
            <Globe2 aria-hidden="true" />
            <p>No browser tabs open.</p>
            <Button
              callback={handleAddTab}
              icon={<Plus aria-hidden="true" />}
              label="New browser tab"
              size="small"
              theme="secondary"
            />
          </div>
        )}
        {Array.from(workspaces, ([currentWorkspaceKey, currentWorkspace]) =>
          currentWorkspace.tabs
            .filter((tab) => tab.loaded)
            .map((tab) => (
              <BrowserPage
                applicationZoomFactor={applicationZoomFactor}
                defaultScale={defaultScale}
                key={tab.id}
                tab={tab}
                visible={
                  active &&
                  currentWorkspaceKey === workspaceKey &&
                  tab.id === currentWorkspace.activeTabId
                }
                onElementChange={handleElementChange}
                onFindResult={handleFindResult}
                onStateChange={handlePageStateChange}
              />
            ))
        )}
      </div>
    </section>
  )
}
