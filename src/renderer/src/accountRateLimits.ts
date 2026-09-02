import type {
  ProviderAccountRateLimit,
  ProviderAccountRateLimitResetCredit
} from '../../shared/provider'

const minimumUsedPercentForReset = 95
const expiringResetCreditWindowMilliseconds = 2 * 24 * 60 * 60 * 1_000

const clampPercent = (value: number): number => Math.min(Math.max(value, 0), 100)

const toTimestampMilliseconds = (timestamp: number): number =>
  timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000

export const shouldDisableRateLimitReset = (
  rateLimits: readonly ProviderAccountRateLimit[],
  resetCredits: readonly ProviderAccountRateLimitResetCredit[] | null = null,
  now = Date.now()
): boolean =>
  rateLimits.length > 0 &&
  rateLimits.every((limit) => clampPercent(limit.usedPercent) < minimumUsedPercentForReset) &&
  !resetCredits?.some((credit) => {
    if (credit.expiresAt == null) return false

    const expiresIn = toTimestampMilliseconds(credit.expiresAt) - now
    return expiresIn > 0 && expiresIn <= expiringResetCreditWindowMilliseconds
  })

const isMainRateLimit = (limit: ProviderAccountRateLimit): boolean =>
  limit.id == null ||
  limit.id === 'codex' ||
  limit.id === 'five_hour' ||
  limit.id === 'seven_day' ||
  limit.label.toLocaleLowerCase() === 'codex'

export const groupAccountRateLimits = (
  rateLimits: ProviderAccountRateLimit[],
  selectedUsageScope: string | undefined
): {
  visibleRateLimits: ProviderAccountRateLimit[]
  detailedRateLimits: ProviderAccountRateLimit[]
} => {
  const selectedScopedLimit = selectedUsageScope
    ? rateLimits.find((limit) => limit.usageScope === selectedUsageScope)
    : undefined
  const mainRateLimits = rateLimits.filter(
    (limit) => isMainRateLimit(limit) && (!selectedScopedLimit || limit.id !== 'seven_day')
  )
  if (selectedScopedLimit) mainRateLimits.push(selectedScopedLimit)

  if (mainRateLimits.length === 0) {
    return {
      visibleRateLimits: rateLimits.slice(0, 1),
      detailedRateLimits: rateLimits.slice(1)
    }
  }

  const visibleLimits = new Set(mainRateLimits)
  return {
    visibleRateLimits: mainRateLimits,
    detailedRateLimits: rateLimits.filter((limit) => !visibleLimits.has(limit))
  }
}
