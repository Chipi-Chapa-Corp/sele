import type { PointerEvent, ReactElement, ReactNode } from 'react'
import type { WorkspaceController } from '../../useWorkspaceController'

type WorkspaceShellProps = WorkspaceController['layout'] & {
  chatSidebar: ReactNode
  conversation: ReactNode
  changesSidebar: ReactNode
}

export function WorkspaceShell(props: WorkspaceShellProps): ReactElement {
  const {
    changesResizeHandleRef,
    changesSidebar,
    changesSidebarExpanded,
    chatSidebar,
    conversation,
    handleStartChatResize,
    panelsRef,
    panelsStyle,
    resizeHandleRef
  } = props

  const blurHandle = (event: PointerEvent<HTMLDivElement>): void => event.currentTarget.blur()

  return (
    <div
      className={`chat__panels${changesSidebarExpanded ? ' chat__panels--changes-expanded' : ''}`}
      ref={panelsRef}
      style={panelsStyle}
    >
      <div className="chat__sidebar-panel" data-panel="true" id="sidebar">
        {chatSidebar}
      </div>
      <div
        className="chat__resize-handle"
        ref={resizeHandleRef}
        id="chat-sidebar-resize"
        role="separator"
        aria-label="Resize chat from left"
        aria-orientation="vertical"
        onFocus={(event) => event.currentTarget.blur()}
        onPointerDown={(event) => handleStartChatResize('left', event)}
        onPointerUp={blurHandle}
      />
      {conversation}
      <div
        className="chat__resize-handle chat__resize-handle--changes"
        ref={changesResizeHandleRef}
        id="chat-changes-resize"
        role="separator"
        aria-label="Resize changes from right"
        aria-orientation="vertical"
        onFocus={(event) => event.currentTarget.blur()}
        onPointerDown={(event) => handleStartChatResize('right', event)}
        onPointerUp={blurHandle}
      />
      {changesSidebar}
    </div>
  )
}
