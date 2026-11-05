import type { ReactElement, ReactNode } from 'react'
import { FolderCog } from 'lucide-react'
import { Button } from '../../components/Button'
import { useCompactLayout } from '../../useCompactLayout'

export function MobileSessionSetup({
  children,
  project,
  provider
}: {
  children: ReactNode
  project: string
  provider: ReactNode
}): ReactElement {
  const compact = useCompactLayout()
  if (!compact) return <>{children}</>
  return (
    <div className="mobile-session-setup">
      <Button
        theme="secondary"
        label={
          <span className="mobile-session-summary">
            <span>{project}</span>
            <span aria-hidden="true">·</span>
            <span>{provider}</span>
          </span>
        }
        aria-label="Chat setup"
        dropdownLabel="Chat setup"
        icon={<FolderCog />}
        callback={() => {}}
        menuOnly
        fill
        dropdownWidth={360}
        dropdownPlacement="top"
        dropdownContent={() => <div className="mobile-session-fields">{children}</div>}
      />
    </div>
  )
}
