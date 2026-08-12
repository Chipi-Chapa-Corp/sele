import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderAccountRateLimit } from '../../../shared/provider'

type ClaudeRateLimitValue = {
  utilization: number | null
  resets_at: string | null
}

const weeklyWindowMinutes = 10_080

const getScopedLimitId = (displayName: string, index: number): string => {
  const normalizedName = displayName
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `model_${normalizedName || index}`
}

export const mapClaudeRateLimits = (
  limits: SDKControlGetUsageResponse['rate_limits']
): ProviderAccountRateLimit[] => {
  const rateLimits: ProviderAccountRateLimit[] = []
  const modelLabels = new Set<string>()
  const addLimit = (
    id: string,
    label: string,
    displayLabel: string,
    value: ClaudeRateLimitValue | null | undefined,
    windowMinutes = weeklyWindowMinutes,
    usageScope?: string
  ): void => {
    if (!value || value.utilization == null || !Number.isFinite(value.utilization)) return
    const resetsAt = value.resets_at ? Date.parse(value.resets_at) : Number.NaN
    rateLimits.push({
      id,
      label,
      displayLabel,
      usageScope,
      kind: rateLimits.length === 0 ? 'primary' : 'secondary',
      usedPercent: Math.max(0, Math.min(100, value.utilization)),
      windowMinutes,
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null
    })
  }

  addLimit('five_hour', 'Claude', '5-hour limit', limits?.five_hour, 300)
  addLimit('seven_day', 'Claude', 'Weekly limit', limits?.seven_day)
  addLimit(
    'seven_day_oauth_apps',
    'OAuth apps',
    'OAuth apps weekly limit',
    limits?.seven_day_oauth_apps
  )
  addLimit(
    'seven_day_opus',
    'Opus',
    'Opus weekly limit',
    limits?.seven_day_opus,
    weeklyWindowMinutes,
    'opus'
  )
  if (limits?.seven_day_opus?.utilization != null) modelLabels.add('opus')
  addLimit(
    'seven_day_sonnet',
    'Sonnet',
    'Sonnet weekly limit',
    limits?.seven_day_sonnet,
    weeklyWindowMinutes,
    'sonnet'
  )
  if (limits?.seven_day_sonnet?.utilization != null) modelLabels.add('sonnet')
  limits?.model_scoped?.forEach((limit, index) => {
    const displayName = limit.display_name.trim() || 'Model'
    const normalizedName = displayName.toLocaleLowerCase()
    if (modelLabels.has(normalizedName)) return
    modelLabels.add(normalizedName)
    addLimit(
      getScopedLimitId(displayName, index),
      displayName,
      `${displayName} weekly limit`,
      limit,
      weeklyWindowMinutes,
      normalizedName
    )
  })
  if (limits?.extra_usage?.is_enabled) {
    addLimit(
      'extra_usage',
      'Extra usage',
      'Extra usage monthly limit',
      { utilization: limits.extra_usage.utilization, resets_at: null },
      43_200
    )
  }

  return rateLimits
}
