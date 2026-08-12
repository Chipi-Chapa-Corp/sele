import type { ProviderAccountRateLimit } from '../../shared/provider'

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
