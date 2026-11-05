import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe2, Plus, RefreshCw, X } from 'lucide-react'
import { getBrowserFaviconUrl, isBrowserPageUrl } from '../../../shared/browser'
import { Button } from './Button'
import { Input } from './Input'
import { SegmentedControl } from './SegmentedControl'
import './BrowserPanel.css'

type Tab = { id: string; title: string; url: string }
type Props = {
  tabs: Tab[]
  activeTabId: string | null
  activeRuntime: { canGoBack: boolean; canGoForward: boolean; loading: boolean }
  addressDraft: string
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewTab: () => void
  onNavigate: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onAddressChange: (value: string) => void
  onExternal: () => void
  externalLabel?: string
  extraTabsAction?: ReactNode
}
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

export function BrowserChrome({
  tabs,
  activeTabId,
  activeRuntime,
  addressDraft,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onAddressChange,
  onExternal,
  externalLabel = 'Open in host browser',
  extraTabsAction
}: Props): React.ReactElement {
  const tabsRail = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = tabsRail.current
    if (!rail || !rail.clientWidth || rail.scrollWidth <= rail.clientWidth) return
    rail.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    })
  }, [activeTabId, tabs.length])
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  return (
    <>
      <div className="browser-panel__tab-toolbar">
        <div className="browser-panel__tabs-scroll" ref={tabsRail}>
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
              actionCallback: () => onCloseTab(tab.id)
            }))}
            value={activeTabId ?? ''}
            onChange={onSelectTab}
          />
        </div>
        <Button
          aria-label="New browser tab"
          callback={onNewTab}
          icon={<Plus aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="New browser tab"
        />
        {extraTabsAction}
      </div>
      <form
        className="browser-panel__navigation"
        aria-label="Browser navigation"
        onSubmit={(event) => {
          event.preventDefault()
          onNavigate()
        }}
      >
        <Button
          aria-label="Back"
          callback={() => onBack()}
          disabled={!activeTab || !activeRuntime.canGoBack}
          icon={<ArrowLeft aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="Back"
        />
        <Button
          aria-label="Forward"
          callback={() => onForward()}
          disabled={!activeTab || !activeRuntime.canGoForward}
          icon={<ArrowRight aria-hidden="true" />}
          size="small"
          theme="transparent"
          title="Forward"
        />
        <Button
          aria-label="Reload"
          callback={() => onReload()}
          disabled={!activeTab || !activeTab.url}
          icon={
            <RefreshCw
              aria-hidden="true"
              className={
                activeRuntime.loading
                  ? 'app-loading-spinner browser-panel__loading-icon'
                  : undefined
              }
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
          inputMode="url"
          enterKeyHint="go"
          value={addressDraft}
          onChange={(event) => onAddressChange(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            if (activeTab) onAddressChange(activeTab.url)
            event.currentTarget.blur()
          }}
        />
        <Button
          aria-label={externalLabel}
          callback={onExternal}
          disabled={!activeTab || !isBrowserPageUrl(activeTab.url)}
          icon={<ExternalLink aria-hidden="true" />}
          size="small"
          theme="transparent"
          title={externalLabel}
        />
      </form>
    </>
  )
}
