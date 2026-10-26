import type { ProviderAccountRateLimit } from './provider'

const timestamp = (value: number): number => (value < 1e12 ? value * 1000 : value)
export const limitResetKey = (limit: ProviderAccountRateLimit): string =>
  JSON.stringify([limit.id, limit.label, limit.kind, limit.windowMinutes, limit.usageScope])

/** Freeze the next reset at submission time; a later usage response may describe a new window. */
export const nextLimitReset = (
  limits: ProviderAccountRateLimit[],
  now: number,
  usageScope?: string
): { resetsAt: number; limit: ProviderAccountRateLimit } | null => {
  const upcoming = limits.filter(
    (limit) =>
      (!limit.usageScope || !usageScope || limit.usageScope === usageScope) &&
      limit.resetsAt != null &&
      Number.isFinite(limit.resetsAt) &&
      timestamp(limit.resetsAt) > now
  )
  // When several windows are exhausted, wait until all of them allow work again.
  const exhausted = upcoming.filter((limit) => limit.usedPercent >= 100)
  const candidates = exhausted.length ? exhausted : upcoming
  candidates.sort((a, b) =>
    exhausted.length
      ? timestamp(b.resetsAt!) - timestamp(a.resetsAt!)
      : timestamp(a.resetsAt!) - timestamp(b.resetsAt!)
  )
  const limit = candidates[0]
  return limit ? { resetsAt: timestamp(limit.resetsAt!), limit } : null
}
