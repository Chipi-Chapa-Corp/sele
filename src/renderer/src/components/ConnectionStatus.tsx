import type { ReactElement } from 'react'
import '../assets/main.css'
import '../workspace/styles/conversation-requests.css'
import { Banner } from './Banner'
import { Button } from './Button'
import './ConnectionStatus.css'

export function ConnectionStatus({
  message,
  onChooseDevice
}: {
  message: string | null
  onChooseDevice?: () => void
}): ReactElement | null {
  if (!message) return null
  return (
    <Banner
      id="sele-connection-status"
      className="sele-connection-status"
      ariaLabel="Connection status"
      summary={message}
    >
      {onChooseDevice && <Button label="Devices" callback={onChooseDevice} />}
    </Banner>
  )
}
