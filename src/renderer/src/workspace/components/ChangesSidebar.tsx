import type { ReactElement, ReactNode } from 'react'

type ChangesSidebarProps = {
  header: ReactNode
  content: ReactNode
  footer: ReactNode
}

export function ChangesSidebar({ content, footer, header }: ChangesSidebarProps): ReactElement {
  return (
    <div className="chat__changes-panel">
      <aside className="changes-sidebar">
        {header}
        {content}
        {footer}
      </aside>
    </div>
  )
}
