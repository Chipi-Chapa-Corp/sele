import type { ProviderAccountRateLimit } from '../../shared/provider'
import type { AppChatUsageDisplay } from './settings'
import { getUsageBadgeRateLimit } from './accountRateLimits'

export type ChatContextUsage = {
  source: 'exact' | 'estimated' | 'unavailable'
  usedTokens: number | null
  maxTokens: number | null
}

export const getContextPercent = (contextUsage: ChatContextUsage): number | null => {
  if (contextUsage.usedTokens == null || contextUsage.maxTokens == null) return null
  if (contextUsage.maxTokens <= 0) return null
  return Math.min(Math.max((contextUsage.usedTokens / contextUsage.maxTokens) * 100, 0), 100)
}

export const getVisibleUsageBadges = (
  rateLimits: readonly ProviderAccountRateLimit[],
  contextUsage: ChatContextUsage,
  displayUsage: AppChatUsageDisplay
) =>
  (
    [
      { key: 'context', label: 'Context', percent: getContextPercent(contextUsage) },
      {
        key: 'short',
        label: 'Short',
        percent: getUsageBadgeRateLimit(rateLimits, 'short')?.usedPercent ?? null
      },
      {
        key: 'long',
        label: 'Long',
        percent: getUsageBadgeRateLimit(rateLimits, 'long')?.usedPercent ?? null
      }
    ] as const
  ).flatMap((badge) => {
    if (!displayUsage[badge.key] || badge.percent == null || !Number.isFinite(badge.percent))
      return []
    const percent = Math.min(Math.max(badge.percent, 0), 100)
    return [{ ...badge, percent, title: `${badge.label} usage ${Math.round(percent)}% used` }]
  })
