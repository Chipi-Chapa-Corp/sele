import type { ProviderConfigValue } from '../../shared/provider'

export const configFieldLabel = (name: string): string =>
  name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
export const configObject = (
  value: ProviderConfigValue | undefined
): Record<string, ProviderConfigValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
