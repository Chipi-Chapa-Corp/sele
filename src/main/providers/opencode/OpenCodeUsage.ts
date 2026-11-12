import type { AppContainerTarget } from '../../../shared/app'
import type { ProviderAccountRateLimit } from '../../../shared/provider'
import { isRecord } from '../providerValues.ts'

type OpenCodeGoUsageWindow = {
  status?: unknown
  percent?: unknown
  resetsAt?: unknown
}

type OpenCodeGoUsagePayload = {
  rolling?: OpenCodeGoUsageWindow | null
  weekly?: OpenCodeGoUsageWindow | null
  monthly?: OpenCodeGoUsageWindow | null
}

const getApiKeyFromEntry = (entry: unknown): string | null => {
  if (!isRecord(entry)) return null
  if (entry.type === 'api' && typeof entry.key === 'string' && entry.key.trim()) {
    return entry.key.trim()
  }
  return null
}

/** API keys saved in OpenCode's auth store, keyed by OpenCode provider ID. OAuth entries are skipped. */
export const extractOpenCodeApiKeys = (store: unknown): Record<string, string> => {
  if (!isRecord(store)) return {}
  const keys: Record<string, string> = {}
  for (const [providerId, entry] of Object.entries(store)) {
    const key = getApiKeyFromEntry(entry)
    if (key) keys[providerId] = key
  }
  return keys
}

export const usesLocalOpenCodeAuth = (
  container: AppContainerTarget | null | undefined,
  flatpak: boolean,
  hasHostBridge: boolean
): boolean => container?.kind !== 'container' && !flatpak && !hasHostBridge

/** Whether OpenCode for this target runs with Sele's own filesystem and environment. */
export const isLocalOpenCodeTarget = async (
  container?: AppContainerTarget | null
): Promise<boolean> => {
  const { getCurrentContainerHostBridge } = await import('../../currentContainer')
  return usesLocalOpenCodeAuth(
    container,
    Boolean(process.env.FLATPAK_ID),
    Boolean(await getCurrentContainerHostBridge())
  )
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value))

const toResetsAt = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

export const mapOpenCodeGoUsageToRateLimits = (
  usage: OpenCodeGoUsagePayload
): ProviderAccountRateLimit[] => {
  const rateLimits: ProviderAccountRateLimit[] = []
  const addLimit = (
    id: string,
    displayLabel: string,
    window: OpenCodeGoUsageWindow | null | undefined,
    windowMinutes: number
  ): void => {
    const percent = typeof window?.percent === 'number' ? window.percent : null
    if (percent == null || !Number.isFinite(percent)) return
    rateLimits.push({
      id,
      label: 'OpenCode Go',
      displayLabel,
      kind: rateLimits.length === 0 ? 'primary' : 'secondary',
      usedPercent: clampPercent(percent),
      windowMinutes,
      resetsAt: toResetsAt(window?.resetsAt)
    })
  }
  addLimit('five_hour', '5-hour limit', usage.rolling, 300)
  addLimit('weekly', 'Weekly limit', usage.weekly, 10_080)
  addLimit('monthly', 'Monthly limit', usage.monthly, 43_200)
  return rateLimits
}
