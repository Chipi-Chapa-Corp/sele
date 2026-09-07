import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserPanel } from '../../src/renderer/src/components/BrowserPanel'
import { browserApi } from '../../src/renderer/src/browserApi'
import '../../src/renderer/src/assets/main.css'

export function Fixture(): React.JSX.Element {
  const [active, setActive] = useState(true)
  const [opened, setOpened] = useState(false)
  useEffect(() => browserApi.onAutomationOpen(() => setOpened(true)), [])
  useEffect(() => browserApi.onAutomationVisibility(setActive), [])
  return (
    <div style={{ width: 850, height: 650 }}>
      {opened && (
        <BrowserPanel
          active={active}
          view="chat"
          workspaceKey="chat:codex:browser-test-session"
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
