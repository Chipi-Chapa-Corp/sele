export type NetworkRetrySettings = { count: number; delaySeconds: number }

export const defaultNetworkRetrySettings: NetworkRetrySettings = { count: 10, delaySeconds: 2 }
export const networkRetryCountMax = 1000
export const networkRetryDelaySecondsMin = 0.1
export const networkRetryDelaySecondsMax = 86400

export const normalizeNetworkRetryCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(networkRetryCountMax, Math.max(0, Math.floor(value)))
    : defaultNetworkRetrySettings.count

export const normalizeNetworkRetryDelaySeconds = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(networkRetryDelaySecondsMax, Math.max(networkRetryDelaySecondsMin, value))
    : defaultNetworkRetrySettings.delaySeconds

export const normalizeNetworkRetrySettings = (
  value: Partial<NetworkRetrySettings> | undefined
): NetworkRetrySettings => ({
  count: normalizeNetworkRetryCount(value?.count),
  delaySeconds: normalizeNetworkRetryDelaySeconds(value?.delaySeconds)
})
