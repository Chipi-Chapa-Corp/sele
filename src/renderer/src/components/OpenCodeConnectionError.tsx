import type { ReactElement } from 'react'
import { Button } from './Button'
import { RequestErrorBanner } from './RequestErrorBanner'

export function OpenCodeConnectionError({
  failure,
  onManage
}: {
  failure: { name: string; message: string }
  onManage: () => void
}): ReactElement {
  return (
    <RequestErrorBanner message={failure.message} ariaLabel="OpenCode connection error">
      <Button callback={onManage} label="Manage Providers" theme="transparent" size="small" />
    </RequestErrorBanner>
  )
}
