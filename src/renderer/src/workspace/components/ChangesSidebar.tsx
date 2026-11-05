import type { ReactElement, ReactNode } from 'react'

type ChangesSidebarProps = {
  header: ReactNode
  content: ReactNode
  footer: ReactNode
  inert?: boolean
}

export function ChangesSidebar({
  content,
  footer,
  header,
  inert
}: ChangesSidebarProps): ReactElement {
  return (
    <div className="chat__changes-panel" inert={inert}>
      <aside className="changes-sidebar">
        {header}
        {content}
        {footer}
      </aside>
    </div>
  )
}
