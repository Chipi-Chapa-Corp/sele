import type { AppContainerTarget } from '../../shared/app'

/** Distrobox/Toolbox share the local user's network and home, so host tool
 * transports remain reachable. Separate network namespaces need forwarding. */
export const supportsLocalHostTools = (target: AppContainerTarget | null | undefined): boolean =>
  !target || target.kind === 'host' || target.tool === 'distrobox' || target.tool === 'toolbox'
