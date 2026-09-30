import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCw } from 'lucide-react'
import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderId } from '../../../shared/provider'
import {
  formatTokenUsageCount,
  formatUsageDollars,
  getTokenCost,
  totalTokenUsage,
  type TokenUsage,
  type TokenUsageSummary
} from '../../../shared/tokenUsage'
import { providerApi } from '../providerApi'
import { Button } from './Button'
import { RollingValue } from './RollingValue'
import './TokenUsagePanel.css'

const categories = [
  { key: 'cachedInputTokens', costKey: 'cachedInput', label: 'Cached input', color: 'cached' },
  { key: 'inputTokens', costKey: 'input', label: 'Input', color: 'input' },
  { key: 'outputTokens', costKey: 'output', label: 'Output', color: 'output' }
] as const
const exactCount = (count: number): string => count.toLocaleString('en')

/** One visual language for chat and period totals; categories never overlap. */
export function TokenUsageCard({
  label,
  caption,
  scope,
  history,
  usage
}: {
  label: string
  caption?: string
  scope: 'chat' | 'provider'
  history?: TokenUsageSummary['history']
  usage: TokenUsage | null
}): React.ReactElement {
  const total = usage ? totalTokenUsage(usage) : 0
  const cost = usage ? getTokenCost(usage) : null
  return (
    <section className="token-usage__card" aria-label={`${label} token usage`}>
      <div className="token-usage__heading">
        <div>
          <h3>{label}</h3>
          {caption && <p>{caption}</p>}
        </div>
        <strong
          title={
            usage
              ? `${exactCount(total)} recorded tokens · ${
                  cost?.total != null
                    ? `$${formatUsageDollars(cost.total)} estimated cost${usage.costUsesFallback ? '; historical records without a model use saved rates from this chat or provider source.' : ''}`
                    : 'Cost estimate unavailable: some recorded usage has no model or price.'
                } ${history === 'native' ? (scope === 'chat' ? 'Includes retained native API-call history for this chat and its subagents.' : 'Includes retained native API-call history across chats and sources for the selected provider.') : scope === 'chat' ? 'Includes usage collected by Sele for this chat and its subagents.' : 'Includes usage collected by Sele across all chats and sources for the selected provider in this period.'} ${history === 'native' ? 'Deleted or unrecorded native history is absent; refreshes every 15 seconds.' : history === 'mixed' ? 'Combines retained native history with Sele-recorded usage for sources without native history.' : 'Activity not collected by Sele is absent from these totals.'}`
              : 'No recorded usage'
          }
        >
          {usage ? formatTokenUsageCount(total) : '—'}
          <span>
            $<RollingValue value={formatUsageDollars(cost?.total)} />
          </span>
        </strong>
      </div>
      <div
        className="token-usage__bar"
        role="img"
        aria-label={
          usage
            ? categories
                .map(({ key, label: category }) => `${category}: ${exactCount(usage[key])} tokens`)
                .join(', ')
            : 'No recorded usage'
        }
      >
        {usage &&
          total > 0 &&
          categories.map(({ key, color, label: category }) => (
            <span
              key={key}
              className={`token-usage__segment token-usage__segment--${color}`}
              style={{ width: `${(usage[key] / total) * 100}%` }}
              title={`${category}: ${exactCount(usage[key])} (${Math.round((usage[key] / total) * 100)}%)`}
            />
          ))}
      </div>
      <dl className="token-usage__legend">
        {categories.map(({ key, costKey, label: category, color }) => (
          <div key={key}>
            <dt>
              <i className={`token-usage__swatch token-usage__segment--${color}`} />
              {category}
            </dt>
            <dd title={usage ? `${exactCount(usage[key])} tokens` : undefined}>
              {usage ? formatTokenUsageCount(usage[key]) : '—'}
              {usage && <span>{total > 0 ? Math.round((usage[key] / total) * 100) : 0}%</span>}
              <span
                title={
                  cost?.[costKey] != null
                    ? usage?.costUsesFallback
                      ? 'Estimated from recorded token counts; historical records without a model use saved rates from this chat or provider source.'
                      : 'Estimated category cost; native totals are apportioned using model rates.'
                    : 'Category cost estimate unavailable: some recorded usage has no model or rate.'
                }
              >
                $<RollingValue value={formatUsageDollars(cost?.[costKey])} />
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function TokenUsagePanel(props: {
  providerId: ProviderId
  chatId?: string | null
  container?: AppContainerTarget | null
}): React.ReactElement {
  const sourceJSON = JSON.stringify(props.container ?? null)
  return (
    <TokenUsagePanelContent
      key={JSON.stringify([props.providerId, props.chatId, sourceJSON])}
      providerId={props.providerId}
      chatId={props.chatId}
      sourceJSON={sourceJSON}
    />
  )
}

function TokenUsagePanelContent({
  providerId,
  chatId,
  sourceJSON
}: {
  providerId: ProviderId
  chatId?: string | null
  sourceJSON: string
}): React.ReactElement {
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useRef<() => Promise<void>>(() => Promise.resolve())
  useEffect(() => {
    let cancelled = false
    let inFlight = false
    setSummary(null)
    setError(null)
    const load = async (): Promise<void> => {
      if (inFlight) return
      inFlight = true
      try {
        const result = await providerApi.getTokenUsage(providerId, chatId, {
          container: JSON.parse(sourceJSON) as AppContainerTarget | null
        })
        if (!cancelled) {
          setSummary(result)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Unable to load token usage.')
      } finally {
        inFlight = false
      }
    }
    reload.current = load
    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [providerId, chatId, sourceJSON])

  return (
    <div className="token-usage" role="tabpanel" aria-label="Token usage">
      {!summary && !error && (
        <p className="token-usage__status" role="status">
          <LoaderCircle className="app-loading-spinner" size={14} /> Loading usage…
        </p>
      )}
      {error && (
        <div className="token-usage__status" role="status">
          <span>{error}</span>
          <Button
            callback={() => reload.current()}
            size="small"
            theme="transparent"
            icon={<RotateCw />}
            title="Retry token usage"
            aria-label="Retry token usage"
          />
        </div>
      )}
      {summary && (
        <>
          <TokenUsageCard
            label="This chat"
            scope="chat"
            history={summary.history}
            caption={chatId ? undefined : 'Select a chat to see its usage'}
            usage={summary.chat}
          />
          <TokenUsageCard
            label="Last 7 days"
            scope="provider"
            history={summary.history}
            usage={summary.week}
          />
          <TokenUsageCard
            label="Last 30 days"
            scope="provider"
            history={summary.history}
            usage={summary.month}
          />
        </>
      )}
    </div>
  )
}
