import { mobileLinkUrl } from './mobileBrowserUrl'
import { isRemoteClient } from './runtimeCapabilities'

/** Read the endpoint currently in use, so DHCP/reconnects do not leave stale links. */
export const remoteHostOrigin = (): string =>
  (window as Window & { seleHostOrigin?: () => string }).seleHostOrigin?.() ?? location.origin

export const resolveRemoteUrl = (url: string): string =>
  isRemoteClient() ? mobileLinkUrl(url, remoteHostOrigin()) : url
