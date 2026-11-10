import type { AppContainerTarget } from '../../shared/app'
import type { ProviderTurnOptions } from '../../shared/provider'

// Official extensions use host-local native messaging. Container network/home
// sharing alone does not make the provider's native host available there.
export const usesNativeChrome = (
  options: Pick<ProviderTurnOptions, 'nativeChrome' | 'sandboxMode'> | undefined,
  container: AppContainerTarget | null | undefined
): boolean =>
  options?.nativeChrome === true &&
  options.sandboxMode !== 'read-only' &&
  (!container || container.kind === 'host')
