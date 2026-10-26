import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserPanel } from '../../../src/renderer/src/components/BrowserPanel'
import { browserApi } from '../../../src/renderer/src/browserApi'
import type { BrowserOpenRequest } from '../../../src/shared/browser'
import { initializePreferences } from '../../../src/renderer/src/preferences'
import '../../../src/renderer/src/assets/main.css'

export function Fixture(): React.JSX.Element {
  const [active, setActive] = useState(true)
  const [opened, setOpened] = useState(false)
  const [openRequest, setOpenRequest] = useState<BrowserOpenRequest | null>(null)
  const [workspaceOverride, setWorkspaceOverride] = useState<string | null>(null)
  const [view, setView] = useState<'chat' | 'project' | 'global'>('chat')
  useEffect(() => {
    ;(window as unknown as { setBrowserTestView: typeof setView }).setBrowserTestView = setView
    Object.assign(window, {
      browserTabReuseFixture: {
        active: setActive,
        mount: setOpened,
        workspace: setWorkspaceOverride,
        open: (url: string) => {
          setOpenRequest({ id: crypto.randomUUID(), url })
          setOpened(true)
        }
      }
    })
  }, [])
  useEffect(
    () =>
      browserApi.onAutomationOpen((id) => {
        if ((window as unknown as { browserTestDisabled?: boolean }).browserTestDisabled) {
          browserApi.automationRespond({
            id,
            error: 'The in-app browser is disabled in Sele settings.'
          })
          return
        }
        browserApi.automationAccept(id)
        setOpened(true)
      }),
    []
  )
  useEffect(() => browserApi.onAutomationVisibility(setActive), [])
  useEffect(
    () =>
      browserApi.onOpenRequested((request) => {
        setOpenRequest(request)
        setOpened(true)
      }),
    []
  )
  return (
    <div style={{ width: 850, height: 650 }}>
      <textarea id="prompt" aria-label="Prompt" autoFocus defaultValue="Draft prompt" />
      {opened && (
        <BrowserPanel
          active={active}
          openRequest={openRequest}
          view={view}
          workspaceKey={
            workspaceOverride ??
            (view === 'chat'
              ? 'chat:codex:browser-test-session'
              : view === 'global'
                ? 'global'
                : 'project:host\0/work')
          }
          appZoomLevel={0}
          defaultScale={100}
        />
      )}
    </div>
  )
}
void initializePreferences().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Fixture />
    </StrictMode>
  )
})
