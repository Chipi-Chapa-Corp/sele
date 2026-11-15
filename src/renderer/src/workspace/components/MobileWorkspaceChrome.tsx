import { ArrowLeft, PanelsTopLeft, PanelLeft, SquarePen } from 'lucide-react'
import type { ReactElement } from 'react'
import { Button } from '../../components/Button'
import { isRemoteClient } from '../../runtimeCapabilities'
import type { WorkspaceController } from '../../useWorkspaceController'

export type MobileWorkspacePane = 'chats' | 'conversation' | 'workspace'

export function CompactWindowTitlebar({
  renderWindowControls
}: Pick<WorkspaceController['chatSidebar'], 'renderWindowControls'>): ReactElement | null {
  if (isRemoteClient()) return null
  const leftControls = renderWindowControls('darwin')
  const rightControls = renderWindowControls('default')
  if (!leftControls && !rightControls) return null

  return (
    <div className="compact-window-titlebar">
      {leftControls}
      {rightControls}
    </div>
  )
}

export function MobileWorkspaceNavigation(props: {
  pane: 'conversation' | 'workspace'
  sidebarOpen: boolean
  title: string
  onPane(pane: MobileWorkspacePane): void
  onNewChat(): void
  onBack(): void
}): ReactElement {
  return (
    <header className="mobile-conversation-header" data-pane={props.pane} inert={props.sidebarOpen}>
      <Button
        theme="secondary"
        aria-label="Open sidebar"
        aria-controls="sidebar"
        aria-expanded={props.sidebarOpen}
        icon={<PanelLeft />}
        callback={() => props.onPane('chats')}
      />
      <span className="mobile-conversation-header__title">
        {props.pane === 'workspace' ? 'Workspace' : props.title}
      </span>
      <Button
        theme="secondary"
        aria-label={props.pane === 'workspace' ? 'Back' : 'Open workspace'}
        icon={props.pane === 'workspace' ? <ArrowLeft /> : <PanelsTopLeft />}
        callback={() => (props.pane === 'workspace' ? props.onBack() : props.onPane('workspace'))}
      />
      <Button
        theme="secondary"
        aria-label="New chat"
        icon={<SquarePen />}
        callback={props.onNewChat}
      />
    </header>
  )
}
