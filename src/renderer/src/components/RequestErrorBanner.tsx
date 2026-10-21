import type { ReactElement, ReactNode } from 'react'
import { getRequestErrorPresentation } from '../requestError'

export function RequestErrorBanner({
  message,
  children,
  ariaLabel = 'Request error'
}: {
  message: string
  children?: ReactNode
  ariaLabel?: string
}): ReactElement {
  const presentation = getRequestErrorPresentation(message)
  return (
    <section className="chat-approval chat-request-error" aria-label={ariaLabel} role="alert">
      <div className="chat-approval__main">
        {presentation.label && <span className="chat-approval__label">{presentation.label}</span>}
        <span className="chat-approval__summary" title={presentation.summary}>
          {presentation.summary}
        </span>
      </div>
      {children && <div className="chat-approval__actions">{children}</div>}
    </section>
  )
}
