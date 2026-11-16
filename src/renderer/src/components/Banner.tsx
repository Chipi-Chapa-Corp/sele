import type { ReactElement, ReactNode } from 'react'

export function Banner({
  label,
  summary,
  children,
  className = '',
  role = 'status',
  ariaLabel,
  id
}: {
  label?: string | null
  summary: string
  children?: ReactNode
  className?: string
  role?: 'status' | 'alert'
  ariaLabel: string
  id?: string
}): ReactElement {
  return (
    <section id={id} className={`chat-approval ${className}`} aria-label={ariaLabel} role={role}>
      <div className="chat-approval__main">
        {label && <span className="chat-approval__label">{label}</span>}
        <span className="chat-approval__summary" title={summary}>
          {summary}
        </span>
      </div>
      {children && <div className="chat-approval__actions">{children}</div>}
    </section>
  )
}
