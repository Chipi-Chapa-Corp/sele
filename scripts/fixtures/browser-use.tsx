import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserPanel } from '../../src/renderer/src/components/BrowserPanel'
import { browserApi } from '../../src/renderer/src/browserApi'
import '../../src/renderer/src/assets/main.css'

export function Fixture(): React.JSX.Element {
  const [active, setActive] = useState(true)
  const [opened, setOpened] = useState(false)
  const [view, setView] = useState<'chat' | 'project' | 'global'>('chat')
  useEffect(() => {
    ;(window as unknown as { setBrowserTestView: typeof setView }).setBrowserTestView = setView
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
  return (
    <div style={{ width: 850, height: 650 }}>
      {opened && (
        <BrowserPanel
          active={active}
          view={view}
          workspaceKey={
            view === 'chat'
              ? 'chat:codex:browser-test-session'
              : view === 'global'
                ? 'global'
                : 'project:host\0/work'
          }
          appZoomLevel={0}
          defaultScale={100}
        />
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>
)
