import { useEffect, useState } from 'react'
import type { ProviderWorkingStep } from '../../../shared/provider'
import { getWorkingElapsedTime } from '../workingElapsedTime'

/** Only this small label ticks; no provider requests or conversation rerenders. */
export const WorkingElapsedTime: React.FC<{ item: ProviderWorkingStep }> = ({ item }) => {
  const [, tick] = useState(0)
  const active = item.status === 'working' && item.startedAt != null
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => tick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  const elapsed = getWorkingElapsedTime(item, Date.now())
  return elapsed ? <span className="chat-detail__working-elapsed"> · {elapsed}</span> : null
}
