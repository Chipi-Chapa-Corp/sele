import { formatTurnTokenUsage } from '../../../shared/tokenUsage'
import { useEffect, useState } from 'react'
import type { ProviderWorkingStep } from '../../../shared/provider'
import { getWorkingElapsedTime } from '../workingElapsedTime'
import { RollingValue } from './RollingValue'

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
  const usage = item.tokenUsage
  if (!elapsed && !usage) return null
  return (
    <span className="chat-detail__working-elapsed">
      {elapsed && (
        <>
          {' · '}
          <RollingValue value={elapsed} />
        </>
      )}
      {usage && (
        <span
          title={`${(usage.inputTokens + usage.cachedInputTokens).toLocaleString()} input tokens (including ${usage.cachedInputTokens.toLocaleString()} cached), ${usage.outputTokens.toLocaleString()} output tokens${usage.costUsesFallback ? '. Price uses fallback model rates because the historical model was not recorded.' : ''}`}
        >
          {' '}
          · <RollingValue value={formatTurnTokenUsage(usage)} />
        </span>
      )}
    </span>
  )
}
