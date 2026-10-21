import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence } from 'motion/react'
import { LoaderCircle, Shrink } from 'lucide-react'
import type { AppContainerTarget } from '../../../shared/app'
import type {
  ProviderAccountRateLimitResetOutcome,
  ProviderAccountUsage,
  ProviderId,
  ProviderUsageOptions
} from '../../../shared/provider'
import { formatTokenCostEstimateTitle, formatUsageDollars } from '../../../shared/tokenUsage'
import {
  groupAccountRateLimits,
  shouldDisableRateLimitReset,
  sortRateLimitsForDisplay
} from '../accountRateLimits'
import {
  formatRateLimitResetExpirationDate,
  getRateLimitResetMessage,
  groupRateLimitResetCreditsByExpiration
} from '../rateLimitReset'
import type { AppChatUsageDisplay } from '../settings'
import { getContextPercent, getVisibleUsageBadges, type ChatContextUsage } from '../usageBadges'
import { MotionSurface } from '../motion/MotionSurface'
import { Button } from './Button'
import { DisclosureToggle } from './DisclosureToggle'
import { RateLimitResetButton } from './RateLimitResetButton'
import { SegmentedControl } from './SegmentedControl'
import { TokenUsagePanel } from './TokenUsagePanel'
import './UsageIndicator.css'

export type { ChatContextUsage } from '../usageBadges'

type UsagePopoverView = 'limits' | 'usage' | 'statistics'
type AccountRateLimit = ProviderAccountUsage['rateLimits'][number]

type UsageIndicatorProps = {
  providerId: ProviderId
  chatId?: string | null
  container?: AppContainerTarget | null
  modelUsageScope?: string
  accountUsage: ProviderAccountUsage | null
  accountUsageError: string | null
  accountUsageState: 'idle' | 'loading' | 'ready' | 'error'
  contextUsage: ChatContextUsage
  displayUsage: AppChatUsageDisplay
  compactDisabled?: boolean
  onCompact?: () => Promise<void> | void
  onUsageRefresh?: (options?: ProviderUsageOptions) => Promise<void> | void
  onUsageReset?: () => Promise<ProviderAccountRateLimitResetOutcome>
}

const numberFormatter = new Intl.NumberFormat(undefined)
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: 'compact'
})

const getNumberValue = (value: number | string | null | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null

  const numericValue = Number(value)
  return Number.isSafeInteger(numericValue) ? numericValue : null
}

const formatTokenCount = (value: number | string | null | undefined): string => {
  const numericValue = getNumberValue(value)
  if (numericValue != null) {
    if (numericValue >= 10_000) return compactNumberFormatter.format(numericValue)
    return numberFormatter.format(numericValue)
  }

  return typeof value === 'string' && value
    ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : 'Unknown'
}

const formatPercent = (value: number): string => `${Math.round(value)}%`

const clampPercent = (value: number): number => Math.min(Math.max(value, 0), 100)

const usageStripPath =
  'M28 1.5H48A6.5 6.5 0 0 1 54.5 8V24A6.5 6.5 0 0 1 48 30.5H8A6.5 6.5 0 0 1 1.5 24V8A6.5 6.5 0 0 1 8 1.5Z'

const UsageStrip = ({ usedPercent }: { usedPercent: number | null }): ReactNode => {
  const remainingPercent = usedPercent == null ? 0 : Math.round(100 - usedPercent)

  return (
    <span className="message-box__usage-ring">
      <svg aria-hidden="true" viewBox="0 0 56 32">
        <path className="message-box__usage-track" d={usageStripPath} />
        <path
          className="message-box__usage-strip"
          d={usageStripPath}
          pathLength={100}
          strokeDasharray={remainingPercent >= 100 ? undefined : `${remainingPercent} 100`}
        />
      </svg>
      {usedPercent != null && (
        <span className="message-box__usage-percent">{formatPercent(remainingPercent)}</span>
      )}
    </span>
  )
}

const formatWindowLabel = (windowMinutes: number | null): string => {
  if (windowMinutes == null) return 'current window'
  if (windowMinutes === 60) return 'hourly'
  if (windowMinutes === 1_440) return 'daily'
  if (windowMinutes === 10_080) return 'weekly'

  if (windowMinutes % 10_080 === 0) {
    const weeks = windowMinutes / 10_080
    return weeks === 1 ? 'weekly' : `${weeks} weeks`
  }

  if (windowMinutes % 1_440 === 0) {
    const days = windowMinutes / 1_440
    return days === 1 ? 'daily' : `${days} days`
  }

  if (windowMinutes % 60 === 0) {
    const hours = windowMinutes / 60
    return hours === 1 ? 'hourly' : `${hours} hours`
  }

  return `${windowMinutes} min`
}

const formatResetTime = (resetsAt: number | null): string | null => {
  if (!resetsAt) return null

  const timestamp = resetsAt > 1_000_000_000_000 ? resetsAt : resetsAt * 1_000
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

const formatDurationSeconds = (value: string | null | undefined): string => {
  const seconds = getNumberValue(value)
  if (seconds == null) return 'Unknown'
  if (seconds < 60) return `${numberFormatter.format(seconds)} sec`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${numberFormatter.format(minutes)} min`

  const hours = Math.round(minutes / 60)
  return `${numberFormatter.format(hours)} hr`
}

const formatDayCount = (value: string | null | undefined): string => {
  const days = getNumberValue(value)
  if (days == null) return 'Unknown'

  return days === 1 ? '1 day' : `${numberFormatter.format(days)} days`
}

const getRateLimitUsageFingerprint = (usage: ProviderAccountUsage | null): string =>
  JSON.stringify(usage?.rateLimits ?? null)

export function UsageIndicator({
  providerId,
  chatId,
  container,
  modelUsageScope,
  accountUsage,
  accountUsageError,
  accountUsageState,
  contextUsage,
  displayUsage,
  compactDisabled = false,
  onCompact,
  onUsageRefresh,
  onUsageReset
}: UsageIndicatorProps): ReactElement | null {
  const usagePopoverId = useId().replace(/:/g, '')
  const usageControlRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null)
  const [usageOpen, setUsageOpen] = useState(false)
  const [usageView, setUsageView] = useState<UsagePopoverView>('limits')
  const [otherLimitsOpen, setOtherLimitsOpen] = useState(false)
  const [resetDetailsOpen, setResetDetailsOpen] = useState(false)
  const [rateLimitResetMessage, setRateLimitResetMessage] = useState<string | null>(null)
  const [rateLimitRefreshBaseline, setRateLimitRefreshBaseline] = useState<string | null>(null)
  const rateLimitResetBaselineRef = useRef<string | null>(null)
  const usageMenuOpen = usageOpen

  useLayoutEffect(() => {
    const reference = usageControlRef.current
    const floating = popoverRef.current
    if (!usageMenuOpen || !reference || !floating) return
    let active = true
    const update = (): void => {
      if (reference.getClientRects().length === 0) {
        setUsageOpen(false)
        return
      }
      void computePosition(reference, floating, {
        strategy: 'fixed',
        placement: 'top-end',
        middleware: [offset(6), flip(), shift({ padding: 8 })]
      }).then(({ x, y }) => {
        if (active) setPopoverStyle({ left: x, top: y })
      })
    }
    const cleanup = autoUpdate(reference, floating, update)
    return () => {
      active = false
      cleanup()
    }
  }, [usageMenuOpen])

  useEffect(() => {
    if (!usageMenuOpen) return

    const handleClick = (event: MouseEvent): void => {
      const target = event.target
      if (
        target instanceof Node &&
        (usageControlRef.current?.contains(target) || popoverRef.current?.contains(target))
      )
        return

      setUsageOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setUsageOpen(false)
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [usageMenuOpen])

  const rateLimitUsageFingerprint = getRateLimitUsageFingerprint(accountUsage)

  useEffect(() => {
    if (rateLimitRefreshBaseline === null) return

    if (rateLimitUsageFingerprint !== rateLimitRefreshBaseline) {
      let active = true

      queueMicrotask(() => {
        if (active) setRateLimitRefreshBaseline(null)
      })

      return () => {
        active = false
      }
    }

    let active = true
    let refreshTimeout: number | null = null

    const scheduleRefresh = (): void => {
      refreshTimeout = window.setTimeout(() => {
        void (async () => {
          try {
            await onUsageRefresh?.()
          } catch (error) {
            console.error('Unable to refresh account usage while polling.', error)
            // Keep polling after transient refresh failures.
          } finally {
            if (active) scheduleRefresh()
          }
        })()
      }, 1_000)
    }

    scheduleRefresh()

    return () => {
      active = false
      if (refreshTimeout !== null) window.clearTimeout(refreshTimeout)
    }
  }, [onUsageRefresh, rateLimitRefreshBaseline, rateLimitUsageFingerprint])

  const accountUsageErrors = accountUsage?.errors ?? []
  const tokenUsageSupported = providerId !== 'opencode'
  const statisticsSupported = providerId === 'codex'
  const statisticsReported = Boolean(
    statisticsSupported &&
      accountUsage?.statisticsLoaded &&
      accountUsage.summary &&
      Object.values(accountUsage.summary).some((value) => value !== null)
  )
  const visibleUsageView: UsagePopoverView =
    (usageView === 'statistics' && !statisticsReported) ||
    (usageView === 'usage' && !tokenUsageSupported)
      ? 'limits'
      : usageView
  const statisticsLoading =
    statisticsSupported && accountUsageState === 'loading' && !statisticsReported
  const rateLimits = accountUsage?.rateLimits ?? []
  const { visibleRateLimits, detailedRateLimits } = groupAccountRateLimits(
    rateLimits,
    modelUsageScope
  )
  const contextPercent = getContextPercent(contextUsage)
  const contextPercentLabel = contextPercent == null ? null : formatPercent(contextPercent)
  const badges = getVisibleUsageBadges(rateLimits, contextUsage, displayUsage)
  const availableRateLimitResets = accountUsage?.rateLimitResetCredits?.availableCount ?? 0
  const rateLimitResetDisabled = shouldDisableRateLimitReset(
    rateLimits,
    accountUsage?.rateLimitResetCredits?.credits ?? null
  )
  const resetExpirationGroups = groupRateLimitResetCreditsByExpiration(
    accountUsage?.rateLimitResetCredits?.credits ?? null
  )

  const handleUsageToggle = (): void => {
    const nextOpen = !usageMenuOpen
    setUsageOpen(nextOpen)
    if (nextOpen) {
      if (!statisticsReported && usageView === 'statistics') setUsageView('limits')
      void onUsageRefresh?.({ includeStatistics: true })
    }
  }

  const handleUsageViewChange = (nextView: UsagePopoverView): void => {
    setUsageView(nextView)
    if (nextView === 'statistics' && !accountUsage?.statisticsLoaded) {
      void onUsageRefresh?.({ includeStatistics: true })
    }
  }

  const handleRateLimitReset = (): Promise<ProviderAccountRateLimitResetOutcome> => {
    rateLimitResetBaselineRef.current = getRateLimitUsageFingerprint(accountUsage)
    return onUsageReset?.() ?? Promise.resolve('nothingToReset')
  }

  const handleRateLimitResetResult = async (
    outcome: ProviderAccountRateLimitResetOutcome
  ): Promise<void> => {
    setRateLimitResetMessage(getRateLimitResetMessage(outcome))
    await onUsageRefresh?.()
    if (outcome === 'reset' && onUsageRefresh && rateLimitResetBaselineRef.current !== null) {
      setRateLimitRefreshBaseline(rateLimitResetBaselineRef.current)
    }
  }

  const renderRateLimit = (limit: AccountRateLimit, key: string): ReactNode => {
    const usedPercent = clampPercent(limit.usedPercent)
    const resetTime = formatResetTime(limit.resetsAt)
    const windowLabel = formatWindowLabel(limit.windowMinutes)
    const limitLabel = limit.displayLabel ?? `${limit.label} ${windowLabel}`

    return (
      <div className="message-box__limit" key={key}>
        <span className="message-box__limit-label">{limitLabel}</span>
        <UsageStrip usedPercent={usedPercent} />
        {resetTime && <span className="message-box__limit-reset">{resetTime}</span>}
      </div>
    )
  }

  if (badges.length === 0) return null

  return (
    <div className="message-box__usage-control" ref={usageControlRef}>
      {badges.map((badge) => (
        <Button
          key={badge.key}
          aria-label={badge.title}
          aria-controls={`message-usage-${usagePopoverId}`}
          aria-expanded={usageMenuOpen}
          callback={handleUsageToggle}
          data-usage-limit={badge.key}
          data-pressed={usageMenuOpen ? 'true' : undefined}
          icon={<UsageStrip usedPercent={badge.percent} />}
          size="small"
          theme="transparent"
          title={badge.title}
        />
      ))}
      {createPortal(
        <AnimatePresence>
          {usageMenuOpen && (
            <MotionSurface
              ref={popoverRef}
              style={popoverStyle ?? { visibility: 'hidden' }}
              className="message-box__usage-popover"
              id={`message-usage-${usagePopoverId}`}
              role="dialog"
              aria-label="Usage"
            >
              <SegmentedControl
                aria-label="Usage views"
                className="message-box__usage-tabs"
                options={[
                  { value: 'limits', label: 'Limits' },
                  {
                    value: 'usage',
                    label: 'Usage',
                    disabled: !tokenUsageSupported,
                    ariaLabel: tokenUsageSupported ? 'Usage' : 'Usage unavailable for OpenCode'
                  },
                  ...(statisticsSupported
                    ? [
                        {
                          value: 'statistics' as const,
                          label: statisticsLoading
                            ? 'Statistics'
                            : statisticsReported
                              ? 'Statistics'
                              : 'No statistics',
                          ariaLabel: statisticsLoading
                            ? 'Statistics loading'
                            : statisticsReported
                              ? 'Statistics'
                              : 'No statistics available',
                          disabled: !statisticsReported,
                          icon: statisticsLoading ? (
                            <LoaderCircle className="app-loading-spinner message-box__usage-loading-icon" />
                          ) : undefined
                        }
                      ]
                    : [])
                ]}
                size="small"
                value={visibleUsageView}
                onChange={handleUsageViewChange}
              />

              {visibleUsageView === 'limits' ? (
                <div className="message-box__usage-page" role="tabpanel">
                  <section className="message-box__usage-section">
                    <div className="message-box__usage-row">
                      <span>Context</span>
                      <div className="message-box__context-actions">
                        <strong>
                          {contextUsage.usedTokens == null || contextUsage.usedTokens === 0
                            ? '0'
                            : contextUsage.maxTokens
                              ? `${formatTokenCount(
                                  contextUsage.usedTokens
                                )} / ${formatTokenCount(contextUsage.maxTokens)}`
                              : `${formatTokenCount(contextUsage.usedTokens)} ${
                                  contextUsage.source === 'estimated' ? 'estimated' : 'used'
                                }`}
                        </strong>
                        {onCompact && (
                          <Button
                            callback={onCompact}
                            disabled={compactDisabled}
                            icon={<Shrink />}
                            aria-label="Compact chat context"
                            title="Compact chat context"
                            size="small"
                            theme="transparent"
                          />
                        )}
                      </div>
                    </div>
                    {contextPercentLabel && (
                      <div className="message-box__usage-meter" aria-hidden="true">
                        <span style={{ width: contextPercentLabel }} />
                      </div>
                    )}
                  </section>

                  <section className="message-box__usage-section">
                    {accountUsageState === 'loading' && !accountUsage && (
                      <p className="message-box__usage-status">Loading usage...</p>
                    )}
                    {accountUsageState === 'error' && !accountUsage && (
                      <p className="message-box__usage-status">
                        {accountUsageError ?? 'Limits unavailable.'}
                      </p>
                    )}
                    {visibleRateLimits.length > 0 && (
                      <div className="message-box__limits">
                        {sortRateLimitsForDisplay(visibleRateLimits).map((limit, index) =>
                          renderRateLimit(
                            limit,
                            `${limit.id ?? limit.label}:${limit.kind}:${index}`
                          )
                        )}
                      </div>
                    )}
                    {detailedRateLimits.length > 0 && (
                      <div className="message-box__limits-details">
                        <DisclosureToggle
                          className="message-box__limits-toggle"
                          open={otherLimitsOpen}
                          aria-controls={`message-other-limits-${usagePopoverId}`}
                          onClick={() => setOtherLimitsOpen((currentOpen) => !currentOpen)}
                        >
                          Other limits
                        </DisclosureToggle>
                        {otherLimitsOpen && (
                          <div
                            className="message-box__limits message-box__limits-details-body"
                            id={`message-other-limits-${usagePopoverId}`}
                          >
                            {detailedRateLimits.map((limit, index) =>
                              renderRateLimit(
                                limit,
                                `detail:${limit.id ?? limit.label}:${limit.kind}:${index}`
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {availableRateLimitResets > 0 && onUsageReset && (
                      <>
                        <div className="message-box__usage-reset">
                          <span>
                            {numberFormatter.format(availableRateLimitResets)}{' '}
                            {availableRateLimitResets === 1 ? 'reset' : 'resets'} left
                          </span>
                          <RateLimitResetButton
                            availableCount={availableRateLimitResets}
                            disabled={rateLimitResetDisabled}
                            onReset={handleRateLimitReset}
                            onResetError={setRateLimitResetMessage}
                            onResetResult={handleRateLimitResetResult}
                            onResetStart={() => setRateLimitResetMessage(null)}
                          />
                        </div>
                        {resetExpirationGroups.length > 0 && (
                          <div className="message-box__limits-details">
                            <DisclosureToggle
                              className="message-box__limits-toggle"
                              open={resetDetailsOpen}
                              aria-controls={`message-reset-details-${usagePopoverId}`}
                              onClick={() => setResetDetailsOpen((currentOpen) => !currentOpen)}
                            >
                              Reset details
                            </DisclosureToggle>
                            {resetDetailsOpen && (
                              <div
                                className="message-box__limits-details-body"
                                id={`message-reset-details-${usagePopoverId}`}
                              >
                                {resetExpirationGroups.map((group) => (
                                  <div
                                    className="message-box__usage-row message-box__usage-row--muted"
                                    key={group.expiresAt ?? 'none'}
                                  >
                                    <span>
                                      {group.expiresAt == null
                                        ? 'No expiration'
                                        : `Expires ${formatRateLimitResetExpirationDate(group.expiresAt)}`}
                                    </span>
                                    <strong>
                                      {numberFormatter.format(group.count)}{' '}
                                      {group.count === 1 ? 'reset' : 'resets'}
                                    </strong>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {rateLimitResetMessage && (
                      <p className="message-box__usage-status" role="status">
                        {rateLimitResetMessage}
                      </p>
                    )}
                    {accountUsage &&
                      accountUsage.rateLimits.length === 0 &&
                      accountUsageErrors.length === 0 && (
                        <p className="message-box__usage-status">Usage unavailable.</p>
                      )}
                    {accountUsageErrors.map((usageError, index) => (
                      <p className="message-box__usage-status" key={`${usageError}:${index}`}>
                        {usageError}
                      </p>
                    ))}
                  </section>
                </div>
              ) : visibleUsageView === 'usage' ? (
                <TokenUsagePanel providerId={providerId} chatId={chatId} container={container} />
              ) : (
                <div className="message-box__usage-page" role="tabpanel">
                  <section className="message-box__usage-section">
                    {accountUsage?.statisticsLoaded && accountUsage.summary && (
                      <>
                        <div className="message-box__usage-row">
                          <span>Lifetime tokens</span>
                          <strong
                            title={formatTokenCostEstimateTitle(
                              accountUsage.summary.lifetimeCostUSD,
                              accountUsage.summary.lifetimeCostSample,
                              'Estimated cost of the recorded lifetime usage.'
                            )}
                          >
                            {formatTokenCount(accountUsage.summary.lifetimeTokens)} $
                            {formatUsageDollars(accountUsage.summary.lifetimeCostUSD)}
                          </strong>
                        </div>
                        <div className="message-box__usage-row">
                          <span>Peak day</span>
                          <strong
                            title={formatTokenCostEstimateTitle(
                              accountUsage.summary.peakDailyCostUSD,
                              accountUsage.summary.peakDailyCostSample,
                              'Estimated cost of the peak token day; the highest cost is shown if days tie.'
                            )}
                          >
                            {formatTokenCount(accountUsage.summary.peakDailyTokens)} $
                            {formatUsageDollars(accountUsage.summary.peakDailyCostUSD)}
                          </strong>
                        </div>
                        <div className="message-box__usage-row">
                          <span>Longest turn</span>
                          <strong>
                            {formatDurationSeconds(accountUsage.summary.longestRunningTurnSec)}
                          </strong>
                        </div>
                        <div className="message-box__usage-row">
                          <span>Current streak</span>
                          <strong>{formatDayCount(accountUsage.summary.currentStreakDays)}</strong>
                        </div>
                        <div className="message-box__usage-row">
                          <span>Longest streak</span>
                          <strong>{formatDayCount(accountUsage.summary.longestStreakDays)}</strong>
                        </div>
                      </>
                    )}
                    {accountUsage?.statisticsLoaded && !accountUsage.summary && (
                      <p className="message-box__usage-status">Statistics unavailable.</p>
                    )}
                    {accountUsageErrors.map((usageError, index) => (
                      <p className="message-box__usage-status" key={`${usageError}:${index}`}>
                        {usageError}
                      </p>
                    ))}
                  </section>
                </div>
              )}
            </MotionSurface>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
