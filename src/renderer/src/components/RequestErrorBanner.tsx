import type { ReactElement, ReactNode } from 'react'
import { getRequestErrorPresentation } from '../requestError'
import { Banner } from './Banner'

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
    <Banner
      className="chat-request-error"
      ariaLabel={ariaLabel}
      role="alert"
      label={presentation.label}
      summary={presentation.summary}
    >
      {children}
    </Banner>
  )
}
